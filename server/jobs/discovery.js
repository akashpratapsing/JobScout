import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { CONNECTORS, SOURCE_CATALOG } from './registry.js';
import { createHttp } from './http.js';
import { prefilter, rankForQuery } from './connectors/common.js';
import { dedupeJobs } from './dedupe.js';
import { extractJobSignals } from '../matching/extract.js';
import { buildRulesMatch } from '../matching/score.js';
import { getAiRuntime, isCoolingDown, matchJobsWithAi, recordAiFailure } from '../ai/analyze.js';
import { detectCountry } from '../matching/location.js';
import { decryptString } from '../lib/crypto.js';
import { sleep } from '../lib/util.js';

let activeRunId = null;
let activeRun = null;

export function getActiveRunId() {
  return activeRunId;
}

export function getActiveRun() {
  return activeRun;
}

export async function runSearch({
  store,
  logger,
  secret,
  reason = 'manual',
  onProgress = () => {},
  onRunCreated = () => {},
  runId: requestedRunId = null
}) {
  if (activeRunId) {
    const error = new Error('A search is already running.');
    error.code = 'SEARCH_IN_PROGRESS';
    throw error;
  }
  const state = store.get();
  if (!state.profile) {
    const error = new Error('Upload a resume before searching.');
    error.code = 'NO_PROFILE';
    throw error;
  }
  const enabledSources = (state.preferences.enabledSources || []).filter((id) => CONNECTORS[id]);
  if (!enabledSources.length) {
    const error = new Error('Enable at least one job source in Preferences.');
    error.code = 'NO_SOURCES';
    throw error;
  }

  const runId = requestedRunId || crypto.randomUUID();
  activeRunId = runId;
  const started = Date.now();
  const run = {
    id: runId,
    reason,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    progress: { stage: 'starting', message: 'Preparing search…', completedSources: 0, totalSources: enabledSources.length },
    stats: {
      rawDiscovered: 0,
      normalized: 0,
      newJobs: 0,
      mergedJobs: 0,
      aiMatched: 0,
      rulesOnly: 0,
      expired: 0,
      verificationChecked: 0,
      sourceErrors: 0
    },
    sourceStats: {},
    sourceErrors: [],
    ai: { enabled: false, status: 'not_configured', matched: 0, error: null, model: null }
  };
  activeRun = run;

  await store.update((data) => {
    data.runs.unshift(run);
    data.runs = data.runs.slice(0, 60);
    data.meta.lastSearchAt = run.startedAt;
    data.meta.lastSearchStatus = 'running';
    data.meta.totalSearches = (data.meta.totalSearches || 0) + 1;
  });
  const emit = (patch) => {
    Object.assign(run.progress, patch);
    onProgress(run);
  };
  onRunCreated(run);

  const http = createHttp(logger);
  const titles = pickTitles(state);
  const runtimePreferences = runtimePreferencesFor(state, secret);
  const ctx = {
    http,
    preferences: runtimePreferences,
    titles,
    maxBoards: 30,
    perBoard: 6,
    maxPerFeed: Math.min(80, Math.max(30, runtimePreferences.maxResults || 150)),
    prefilter: (raw) => prefilter(raw, { preferences: runtimePreferences, titles }),
    rank: (raw) => rankForQuery(raw, { titles })
  };

  try {
    emit({ stage: 'discovering', message: `Searching ${enabledSources.length} sources for “${titles.slice(0, 3).join(', ')}”…` });
    const results = await runWithPool(enabledSources, 3, async (sourceId) => {
      const connector = CONNECTORS[sourceId];
      const startedSource = Date.now();
      try {
        const result = await connector.fetchJobs(ctx);
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        for (const warning of warnings) {
          if (run.sourceErrors.length >= 120) break;
          const record = {
            source: sourceId,
            board: warning.board || '',
            message: String(warning.message || warning).slice(0, 400),
            at: new Date().toISOString()
          };
          run.sourceErrors.push(record);
          logger.sourceError({ runId, ...record });
        }
        const status = result.jobs.length ? (warnings.length ? 'partial' : 'ok') : (warnings.length ? 'error' : 'ok');
        run.sourceStats[sourceId] = {
          status,
          jobs: result.jobs.length,
          scanned: result.scanned || 0,
          warnings: warnings.length,
          durationMs: Date.now() - startedSource
        };
        return { sourceId, result };
      } catch (error) {
        const record = {
          source: sourceId,
          board: '',
          message: String(error.message || error).slice(0, 400),
          at: new Date().toISOString()
        };
        if (run.sourceErrors.length < 120) run.sourceErrors.push(record);
        logger.sourceError({ runId, ...record });
        run.sourceStats[sourceId] = { status: 'error', jobs: 0, scanned: 0, warnings: 1, durationMs: Date.now() - startedSource };
        return { sourceId, result: { jobs: [], scanned: 0, warnings: [{ message: record.message }] } };
      } finally {
        run.progress.completedSources = (run.progress.completedSources || 0) + 1;
        emit({
          message: `Searched ${run.progress.completedSources}/${enabledSources.length} sources…`
        });
      }
    });

    const allRaw = results.flatMap((r) => r.result.jobs || []);
    run.stats.rawDiscovered = results.reduce((sum, r) => sum + (r.result.scanned || 0), 0);
    run.stats.normalized = allRaw.length;
    run.stats.sourceErrors = run.sourceErrors.length;
    emit({ stage: 'deduplicating', message: `Normalizing ${allRaw.length} listings and removing duplicates…` });

    const deduped = dedupeJobs(state.jobs, allRaw);
    run.stats.newJobs = deduped.added;
    run.stats.mergedJobs = deduped.merged;
    const jobs = deduped.jobs;

    // Recompute signals and rules scores for jobs that are new or whose content changed.
    const changed = [];
    for (const job of jobs) {
      const isNew = !job.match;
      const contentChanged = job.descriptionHash && job.match?.descriptionHash !== job.descriptionHash;
      if (!isNew && !contentChanged) continue;
      enrichJob(job, state.profile, runtimePreferences);
      changed.push(job);
    }

    emit({ stage: 'matching', message: `Scoring ${changed.length} jobs against your profile…`, matched: 0, totalToMatch: changed.length });
    const aiRuntime = getAiRuntime(store, secret);
    const cooling = isCoolingDown(store);
    let aiCandidates = [];
    if (aiRuntime.enabled && !cooling) {
      aiCandidates = [...changed]
        .sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0) || new Date(b.postedAt || 0) - new Date(a.postedAt || 0))
        .slice(0, config.ai.maxJobsPerRun);
      run.ai.enabled = true;
      run.ai.model = aiRuntime.model;
      run.ai.status = 'running';
      emit({ stage: 'matching', message: `AI is evaluating ${aiCandidates.length} jobs (${aiRuntime.provider.label} · ${aiRuntime.model})…`, totalToMatch: aiCandidates.length });
      try {
        const aiResult = await matchJobsWithAi({
          jobs: aiCandidates,
          profile: state.profile,
          preferences: runtimePreferences,
          runtime: aiRuntime,
          onProgress: (p) => emit({
            stage: 'matching',
            message: `AI evaluated ${p.completed}/${p.total} jobs…`,
            matched: p.completed,
            totalToMatch: p.total
          })
        });
        for (const [jobId, value] of aiResult.matches) {
          const job = jobs.find((j) => j.id === jobId);
          if (!job) continue;
          job.match = { ...value.match, descriptionHash: job.descriptionHash, updatedAt: new Date().toISOString(), model: value.model, provider: aiRuntime.providerId };
          run.stats.aiMatched += 1;
        }
        run.ai.matched = aiResult.matches.size;
        if (aiResult.error) {
          run.ai.status = 'partial';
          run.ai.error = String(aiResult.error.message || aiResult.error).slice(0, 400);
          await recordAiFailure(store, aiResult.error, aiRuntime.apiKey);
        } else {
          run.ai.status = 'ok';
        }
      } catch (error) {
        run.ai.status = 'error';
        run.ai.error = String(error.message || error).slice(0, 400);
        await recordAiFailure(store, error, aiRuntime.apiKey);
      }
    } else if (aiRuntime.enabled && cooling) {
      run.ai.enabled = true;
      run.ai.status = 'cooldown';
      run.ai.error = `AI provider is cooling down until ${cooling}.`;
    } else {
      run.ai.status = 'not_configured';
    }

    // Any job without an AI match keeps its deterministic score and is clearly labelled.
    for (const job of jobs) {
      if (!job.match) {
        enrichJob(job, state.profile, runtimePreferences);
      }
      if (job.match?.method !== 'ai') {
        job.match = { ...job.match, method: 'rules', descriptionHash: job.descriptionHash, updatedAt: new Date().toISOString() };
      }
      if (!job.status) job.status = 'new';
    }
    run.stats.rulesOnly = jobs.filter((j) => j.match?.method === 'rules').length;

    emit({ stage: 'verifying', message: 'Rechecking older listings for expiry…' });
    const verifyResult = await verifyStaleJobs({ jobs, ctx, limit: config.discovery.verifyPerRun, logger, runId });
    run.stats.verificationChecked = verifyResult.checked;
    run.stats.expired = verifyResult.expired;

    const finishedAt = new Date().toISOString();
    run.status = 'completed';
    run.finishedAt = finishedAt;
    run.durationMs = Date.now() - started;
    run.stats.totalJobs = jobs.length;
    run.stats.activeJobs = jobs.filter((j) => j.active !== false).length;
    emit({ stage: 'done', message: 'Search complete.' });

    await store.update((data) => {
      data.jobs = jobs;
      data.sourceState = buildSourceState(data.sourceState, run);
      data.meta.lastSearchStatus = 'completed';
      const stored = data.runs.find((r) => r.id === runId);
      if (stored) Object.assign(stored, run);
    });
    logger.info(`Search ${runId} completed`, {
      raw: run.stats.rawDiscovered,
      new: run.stats.newJobs,
      merged: run.stats.mergedJobs,
      ai: run.ai.status,
      expired: run.stats.expired,
      ms: run.durationMs
    });
    return run;
  } catch (error) {
    run.status = 'error';
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    run.error = String(error.message || error).slice(0, 500);
    await store.update((data) => {
      data.meta.lastSearchStatus = 'error';
      const stored = data.runs.find((r) => r.id === runId);
      if (stored) Object.assign(stored, run);
    });
    logger.error(`Search ${runId} failed`, { error: run.error });
    throw error;
  } finally {
    activeRunId = null;
    activeRun = null;
  }
}

function runtimePreferencesFor(state, secret) {
  const preferences = structuredClone(state.preferences);
  preferences.adzuna = { ...(preferences.adzuna || {}) };
  const encrypted = state.settings?.credentials?.adzunaAppKeyEnc;
  if (encrypted && !preferences.adzuna.appKey) {
    preferences.adzuna.appKey = decryptString(encrypted, secret) || '';
  }
  return preferences;
}

function pickTitles(state) {
  const preferred = (state.preferences.titles || []).filter(Boolean);
  const suggested = (state.profile?.suggestedTitles || []).filter(Boolean);
  const list = preferred.length ? preferred : suggested.length ? suggested : ['Software Engineer'];
  return [...new Set(list)].slice(0, 6);
}

function enrichJob(job, profile, preferences) {
  const signals = extractJobSignals(job);
  const compact = {
    requiredSkills: signals.requiredSkills.map((s) => ({ name: s.name, count: s.count })),
    preferredSkills: signals.preferredSkills.map((s) => ({ name: s.name, count: s.count })),
    mentionedSkills: signals.mentionedSkills.map((s) => ({ name: s.name, count: s.count })),
    experience: signals.experience,
    seniority: signals.seniority,
    workMode: signals.workMode,
    salary: signals.salary,
    degreeRequired: signals.degreeRequired,
    degreeText: signals.degreeText,
    summary: signals.summary,
    sections: signals.sections
  };
  job.signals = compact;
  job.workMode = signals.workMode || job.workMode;
  job.remote = job.workMode === 'remote' || job.remote;
  job.summary = job.summary || signals.summary;
  job.experienceRequired = job.experienceRequired || signals.experience.text || '';
  job.salary = signals.salary;
  job.country = job.country || detectCountry(job.location) || detectCountry((job.description || '').slice(0, 2000)) || '';
  job.match = buildRulesMatch(profile, preferences, job, compact);
  job.match.descriptionHash = job.descriptionHash;
  job.match.updatedAt = new Date().toISOString();
  return job;
}

async function runWithPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildSourceState(existing, run) {
  const next = { ...(existing || {}) };
  for (const [source, stats] of Object.entries(run.sourceStats)) {
    next[source] = {
      ...stats,
      lastRunAt: run.finishedAt || run.startedAt,
      message: run.sourceErrors.find((e) => e.source === source)?.message || ''
    };
  }
  return next;
}

const CLOSED_PATTERNS = [
  /no longer accepting applications/i,
  /this job (?:posting )?(?:has )?expired/i,
  /job (?:posting )?(?:is )?no longer available/i,
  /position (?:has been|is) (?:filled|closed)/i,
  /this (?:job|position) is closed/i,
  /requisition (?:is )?closed/i,
  /we are no longer (?:accepting|considering)/i,
  /page not found/i,
  /job not found/i
];

async function verifyStaleJobs({ jobs, ctx, limit, logger, runId }) {
  const now = Date.now();
  const stale = jobs
    .filter((j) => j.active !== false && j.url && (!j.lastVerifiedAt || now - new Date(j.lastVerifiedAt).getTime() > 12 * 3600 * 1000))
    .sort((a, b) => new Date(a.lastVerifiedAt || 0) - new Date(b.lastVerifiedAt || 0))
    .slice(0, limit);
  let expired = 0;
  for (const job of stale) {
    const result = await verifyJob({ job, http: ctx.http, logger, runId });
    if (result.expired) expired += 1;
    await sleep(250);
  }
  return { checked: stale.length, expired };
}

/**
 * Best-effort check of a single posting URL. Returns { checked, expired,
 * skipped, error }. A skipped check (robots.txt, network error) leaves the job
 * unchanged and does not claim the listing is active or expired.
 */
export async function verifyJob({ job, http, logger = null, runId = '' }) {
  if (!job?.url) return { checked: false, expired: false, skipped: true, error: 'No URL to verify.' };
  try {
    const allowed = await http.robotsAllowed(job.url);
    if (!allowed) {
      logger?.sourceError({ runId, source: job.source, message: `Expiry check skipped (robots.txt): ${job.title}`, url: job.url });
      return { checked: false, expired: false, skipped: true, error: 'robots.txt disallows checking this URL.' };
    }
    const response = await http.request(job.url, {
      source: 'expiry check',
      accept: 'text/html,application/xhtml+xml',
      retries: 0,
      timeoutMs: 15000
    });
    if (response.status === 404 || response.status === 410) {
      markExpired(job, `HTTP ${response.status}`);
      return { checked: true, expired: true, skipped: false, error: '' };
    }
    const html = await response.text();
    const text = html.slice(0, 200000);
    if (CLOSED_PATTERNS.some((re) => re.test(text))) {
      markExpired(job, 'Posting page says the role is closed.');
      return { checked: true, expired: true, skipped: false, error: '' };
    }
    job.lastVerifiedAt = new Date().toISOString();
    job.active = true;
    job.expiredAt = null;
    job.expiredReason = '';
    return { checked: true, expired: false, skipped: false, error: '' };
  } catch (error) {
    if (error.status === 404 || error.status === 410) {
      markExpired(job, `HTTP ${error.status}`);
      return { checked: true, expired: true, skipped: false, error: '' };
    }
    logger?.sourceError({ runId, source: job.source, message: `Expiry check failed for ${job.title}: ${error.message}`, url: job.url });
    return { checked: false, expired: false, skipped: true, error: String(error.message || error).slice(0, 240) };
  }
}

function markExpired(job, reason) {
  job.active = false;
  job.expiredAt = new Date().toISOString();
  job.lastVerifiedAt = job.expiredAt;
  job.expiredReason = reason;
}
