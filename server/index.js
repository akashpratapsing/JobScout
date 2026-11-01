import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './lib/config.js';
import { Store } from './lib/store.js';
import { createLogger } from './lib/logger.js';
import { loadOrCreateSecret, decryptString } from './lib/crypto.js';
import { HttpError, sendJson, readJson, parseMultipart, sameOrigin, securityHeaders } from './lib/http.js';
import { publicProfile, publicSettings, publicJob, jobStats } from './lib/serialize.js';
import { SOURCE_CATALOG, CONNECTORS } from './jobs/registry.js';
import { extractResumeText, heuristicProfile, normalizeProfileInput, summarizeProfileForAi } from './resume.js';
import { getAiRuntime, analyzeResumeWithAi, isCoolingDown, recordAiFailure, recordAiSuccess } from './ai/analyze.js';
import { PROVIDERS, listModels, testProvider } from './ai/providers.js';
import { getActiveRun, getActiveRunId, runSearch, verifyJob } from './jobs/discovery.js';
import { createHttp } from './jobs/http.js';
import { startScheduler } from './scheduler.js';
import {
  sanitizePreferences,
  sanitizeSettings,
  publicPreferences,
  publicManualLinks,
  filterJobs
} from './lib/validation.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const JOB_ROUTE = /^\/api\/jobs\/([^/]+)(?:\/(status|verify))?$/;
const RUN_ROUTE = /^\/api\/runs\/([^/]+)$/;

function safeError(error, apiKey) {
  let text = String(error?.message || error || 'Request failed');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.slice(0, 500);
}

function publicRun(run) {
  if (!run) return null;
  return structuredClone({
    id: run.id,
    reason: run.reason,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    progress: run.progress,
    stats: run.stats,
    sourceStats: run.sourceStats,
    sourceErrors: run.sourceErrors || [],
    ai: run.ai,
    error: run.error || null
  });
}

function sourceConfigured(source, data) {
  if (!source.needsConfig) return true;
  if (source.configType === 'tokens') return (data.preferences.boards?.[source.configKey] || []).length > 0;
  if (source.configType === 'workday') return (data.preferences.boards?.workday || []).length > 0;
  if (source.configType === 'urls') return (data.preferences.boards?.custom || []).length > 0;
  if (source.configType === 'adzuna') {
    return Boolean(data.preferences.adzuna?.appId && data.settings.credentials?.adzunaAppKeyEnc);
  }
  return true;
}

function sourceCatalog(data) {
  const enabled = new Set(data.preferences.enabledSources || []);
  return SOURCE_CATALOG.map((source) => ({
    ...source,
    enabled: enabled.has(source.id),
    configured: sourceConfigured(source, data),
    lastRun: data.sourceState?.[source.id] || null
  }));
}

function buildState(store) {
  const data = store.get();
  const active = getActiveRun();
  return {
    app: { name: 'JobScout', version: config.version },
    profile: publicProfile(data.profile),
    preferences: publicPreferences(data.preferences, data.settings),
    settings: publicSettings(data.settings, { hasKey: Boolean(data.settings.ai?.apiKeyEnc) }),
    stats: jobStats(data.jobs),
    meta: data.meta,
    sources: sourceCatalog(data),
    manual: publicManualLinks(data.profile, data.preferences),
    sourceState: data.sourceState,
    activeRun: publicRun(active),
    coolingDownUntil: isCoolingDown(store),
    aiEnabled: Boolean(data.settings.ai?.enabled && data.settings.ai?.apiKeyEnc)
  };
}

function findJob(store, id) {
  const job = store.get().jobs.find((item) => item.id === id);
  if (!job) throw new HttpError(404, 'Job not found.');
  return job;
}

function runById(store, id) {
  const active = getActiveRun();
  if (active && active.id === id) return active;
  const run = store.get().runs.find((item) => item.id === id);
  if (!run) throw new HttpError(404, 'Search run not found.');
  return run;
}

function exportPayload(data) {
  const copy = structuredClone(data);
  if (copy.settings?.ai) delete copy.settings.ai.apiKeyEnc;
  if (copy.settings?.credentials) delete copy.settings.credentials;
  if (copy.preferences?.adzuna) copy.preferences.adzuna.appKey = '';
  return copy;
}

export function createApp({ store, logger, secret }) {
  const sseClients = new Set();

  function broadcast(event) {
    const safeEvent = event?.type === 'run' && event.run ? { ...event, run: publicRun(event.run) } : event;
    const payload = `data: ${JSON.stringify(safeEvent)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    let relative;
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname).replace(/^\/+/, '');
    } catch {
      throw new HttpError(400, 'Invalid path.');
    }
    if (relative.includes('\0')) throw new HttpError(400, 'Invalid path.');
    const filePath = path.resolve(config.publicDir, relative);
    if (!filePath.startsWith(`${config.publicDir}${path.sep}`)) throw new HttpError(404, 'Not found.');
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found.');
    const body = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...securityHeaders(),
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  }

  async function handleUpload(req, res) {
    const { files } = await parseMultipart(req);
    const file = files.find((item) => item.field === 'resume') || files[0];
    if (!file || !file.buffer?.length) throw new HttpError(400, 'Choose a PDF or DOCX resume to upload.');
    const ext = path.extname(file.filename).toLowerCase();
    if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      throw new HttpError(415, 'Unsupported file type. Upload a PDF or DOCX resume.');
    }
    let text;
    try {
      text = await extractResumeText(file.buffer, file.filename);
    } catch (error) {
      throw new HttpError(422, error.message);
    }
    if (!text || text.replace(/\s/g, '').length < 40) {
      throw new HttpError(422, 'The resume did not contain enough readable text.');
    }
    const state = store.get();
    const profile = heuristicProfile(text, file.filename);
    if (state.settings.privacy?.keepResumeText === false) delete profile.rawText;
    await store.update((data) => {
      data.profile = profile;
      data.meta.lastProfileAt = new Date().toISOString();
    });
    const runtime = getAiRuntime(store, secret);
    logger.info('Resume uploaded and parsed locally', { file: file.filename, chars: text.length });
    sendJson(res, 200, {
      profile: publicProfile(profile),
      ai: {
        available: Boolean(runtime.enabled),
        suggested: Boolean(runtime.enabled && state.settings.privacy?.sendFullResumeText !== false)
      },
      warnings: text.length >= 18000 ? ['The resume is long; AI analysis will use the first 18,000 characters.'] : []
    });
  }

  async function handleAnalyzeProfile(req, res) {
    const state = store.get();
    if (!state.profile) throw new HttpError(400, 'Upload a resume first.');
    const runtime = getAiRuntime(store, secret);
    if (!runtime.enabled) throw new HttpError(400, 'AI is not configured or enabled. Add a free provider key in Settings.');
    const profile = state.profile;
    const sendFull = state.settings.privacy?.sendFullResumeText !== false && Boolean(profile.rawText);
    const text = sendFull
      ? profile.rawText
      : JSON.stringify(summarizeProfileForAi(profile), null, 2);
    try {
      const result = await analyzeResumeWithAi({ text, heuristic: profile, runtime });
      const next = { ...result.profile };
      if (state.settings.privacy?.keepResumeText === false) delete next.rawText;
      else next.rawText = profile.rawText || next.rawText || '';
      next.resumeFileName = profile.resumeFileName || next.resumeFileName || '';
      next.resumeUploadedAt = profile.resumeUploadedAt || next.resumeUploadedAt || '';
      await store.update((data) => {
        data.profile = next;
        data.meta.lastProfileAt = new Date().toISOString();
      });
      await recordAiSuccess(store, result.usage);
      logger.info('Resume analyzed with AI', { provider: result.provider, model: result.model, fullText: sendFull });
      sendJson(res, 200, {
        profile: publicProfile(next),
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        sentFullResumeText: sendFull,
        note: sendFull
          ? 'The resume text was sent to your configured AI provider for this analysis.'
          : 'Only the structured profile was sent to your configured AI provider.'
      });
    } catch (error) {
      await recordAiFailure(store, error, runtime.apiKey);
      logger.warn('AI resume analysis failed', { error: safeError(error, runtime.apiKey) });
      throw new HttpError(error?.status === 429 || error?.code === 'RATE_LIMITED' || error?.quotaExhausted ? 429 : 502, safeError(error, runtime.apiKey));
    }
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      throw new HttpError(403, 'Cross-origin requests are not allowed.');
    }
    const pathname = url.pathname;

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: config.version,
        activeRunId: getActiveRunId(),
        profile: Boolean(store.get().profile),
        uptimeSeconds: Math.round(process.uptime())
      });
      return;
    }

    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        ...securityHeaders(),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      res.write(`data: ${JSON.stringify({ type: 'hello', activeRun: publicRun(getActiveRun()), at: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);
      if (heartbeat.unref) heartbeat.unref();
      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (pathname === '/api/state' && method === 'GET') {
      sendJson(res, 200, buildState(store));
      return;
    }

    if (pathname === '/api/jobs' && method === 'GET') {
      const data = store.get();
      const params = Object.fromEntries(url.searchParams.entries());
      const result = filterJobs(data.jobs, params);
      sendJson(res, 200, {
        jobs: result.jobs.map((job) => publicJob(job)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        stats: jobStats(data.jobs)
      });
      return;
    }

    if (pathname === '/api/jobs/clear' && method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || 'dismissed');
      let removed = 0;
      await store.update((data) => {
        const before = data.jobs.length;
        if (scope === 'all') data.jobs = [];
        else if (scope === 'expired') data.jobs = data.jobs.filter((job) => job.active !== false);
        else if (scope === 'dismissed') data.jobs = data.jobs.filter((job) => job.status !== 'dismissed');
        else throw new HttpError(400, 'Unknown clear scope.');
        removed = before - data.jobs.length;
      });
      sendJson(res, 200, { removed, stats: jobStats(store.get().jobs) });
      return;
    }

    const jobMatch = pathname.match(JOB_ROUTE);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const action = jobMatch[2] || '';
      const job = findJob(store, jobId);

      if (!action && method === 'GET') {
        sendJson(res, 200, { job: publicJob(job, { full: true }) });
        return;
      }
      if (!action && method === 'DELETE') {
        await store.update((data) => {
          data.jobs = data.jobs.filter((item) => item.id !== jobId);
        });
        sendJson(res, 200, { deleted: true, stats: jobStats(store.get().jobs) });
        return;
      }
      if (action === 'status' && method === 'POST') {
        const body = await readJson(req);
        const status = String(body.status || '');
        if (!['new', 'saved', 'applied', 'dismissed'].includes(status)) {
          throw new HttpError(400, 'Status must be new, saved, applied, or dismissed.');
        }
        const now = new Date().toISOString();
        await store.update((data) => {
          const target = data.jobs.find((item) => item.id === jobId);
          if (!target) throw new HttpError(404, 'Job not found.');
          target.status = status;
          if (status === 'saved') target.savedAt = now;
          else if (status === 'applied') target.appliedAt = now;
          else if (status === 'dismissed') target.dismissedAt = now;
          else if (status === 'new') {
            target.savedAt = null;
            target.appliedAt = null;
            target.dismissedAt = null;
          }
          if (body.notes != null) target.notes = String(body.notes).slice(0, 4000);
          target.statusHistory = [
            ...(Array.isArray(target.statusHistory) ? target.statusHistory : []),
            { status, at: now }
          ].slice(-50);
        });
        const updated = findJob(store, jobId);
        sendJson(res, 200, { job: publicJob(updated, { full: true }), stats: jobStats(store.get().jobs) });
        return;
      }
      if (action === 'verify' && method === 'POST') {
        const client = createHttp(logger);
        const verification = await verifyJob({ job, http: client, logger, runId: 'manual-verify' });
        await store.update((data) => {
          const index = data.jobs.findIndex((item) => item.id === jobId);
          if (index >= 0) data.jobs[index] = job;
        });
        sendJson(res, 200, { job: publicJob(findJob(store, jobId), { full: true }), verification });
        return;
      }
      throw new HttpError(405, 'Method not allowed for this job route.');
    }

    if (pathname === '/api/profile' && method === 'GET') {
      sendJson(res, 200, { profile: publicProfile(store.get().profile) });
      return;
    }

    if (pathname === '/api/profile' && method === 'PUT') {
      const body = await readJson(req);
      const current = store.get().profile || {};
      const input = body.profile || body;
      const normalized = normalizeProfileInput(input);
      const profile = {
        ...current,
        ...normalized,
        rawText: current.rawText || '',
        resumeFileName: current.resumeFileName || '',
        resumeUploadedAt: current.resumeUploadedAt || '',
        analysis: {
          ...(current.analysis || {}),
          editedAt: new Date().toISOString(),
          note: current.analysis?.note || 'Edited by you. Local data only.'
        }
      };
      await store.update((data) => {
        data.profile = profile;
        data.meta.lastProfileAt = new Date().toISOString();
      });
      sendJson(res, 200, { profile: publicProfile(profile) });
      return;
    }

    if (pathname === '/api/profile' && method === 'DELETE') {
      await store.update((data) => {
        data.profile = null;
        data.meta.lastProfileAt = null;
      });
      sendJson(res, 200, { deleted: true, profile: null });
      return;
    }

    if (pathname === '/api/resume/upload' && method === 'POST') {
      await handleUpload(req, res);
      return;
    }

    if (pathname === '/api/profile/analyze' && method === 'POST') {
      await handleAnalyzeProfile(req, res);
      return;
    }

    if (pathname === '/api/preferences' && method === 'GET') {
      const data = store.get();
      sendJson(res, 200, {
        preferences: publicPreferences(data.preferences, data.settings),
        sources: sourceCatalog(data)
      });
      return;
    }

    if (pathname === '/api/preferences' && method === 'PUT') {
      const body = await readJson(req);
      const state = store.get();
      const input = body.preferences
        ? { ...body.preferences, adzunaAppKey: body.adzunaAppKey, clearAdzunaKey: body.clearAdzunaKey }
        : body;
      const { preferences, credentialPatch } = sanitizePreferences(input, state.preferences, { secret });
      await store.update((data) => {
        data.preferences = preferences;
        if (credentialPatch) {
          data.settings.credentials = { ...(data.settings.credentials || {}), ...credentialPatch };
        }
        data.settings.schedule = {
          ...(data.settings.schedule || {}),
          enabled: Boolean(preferences.dailyEnabled),
          time: preferences.dailyTime,
          timezone: preferences.dailyTimezone
        };
      });
      sendJson(res, 200, buildState(store));
      return;
    }

    if (pathname === '/api/settings' && method === 'GET') {
      const data = store.get();
      sendJson(res, 200, {
        settings: publicSettings(data.settings, { hasKey: Boolean(data.settings.ai?.apiKeyEnc) }),
        coolingDownUntil: isCoolingDown(store)
      });
      return;
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const body = await readJson(req);
      const state = store.get();
      const settings = sanitizeSettings(body, state.settings, { secret });
      await store.update((data) => {
        data.settings = settings;
        if (data.settings.privacy?.keepResumeText === false && data.profile) delete data.profile.rawText;
      });
      sendJson(res, 200, {
        settings: publicSettings(store.get().settings, { hasKey: Boolean(store.get().settings.ai?.apiKeyEnc) }),
        coolingDownUntil: isCoolingDown(store)
      });
      return;
    }

    if (pathname === '/api/settings/ai/test' && method === 'POST') {
      const body = await readJson(req);
      const state = store.get();
      const current = state.settings.ai;
      const providerId = String(body.provider || current.provider || 'gemini');
      const provider = PROVIDERS[providerId];
      if (!provider) throw new HttpError(400, `Unknown AI provider: ${providerId}`);
      const apiKey = String(body.apiKey || '').trim() || decryptString(current.apiKeyEnc, secret);
      if (!apiKey) throw new HttpError(400, 'Add an API key first.');
      const model = String(body.model || (providerId === current.provider ? current.model : '') || provider.defaultModel).trim();
      if (providerId === 'openrouter' && model && !model.endsWith(':free')) {
        throw new HttpError(400, 'OpenRouter is free-only in JobScout. Choose a :free model.');
      }
      const baseUrl = String(body.baseUrl || (providerId === current.provider ? current.baseUrl : '') || provider.baseUrl || '').trim();
      try {
        const result = await testProvider({ providerId, model, apiKey, baseUrl });
        await store.update((data) => {
          data.settings.ai.lastTestAt = new Date().toISOString();
          data.settings.ai.lastSuccessAt = data.settings.ai.lastTestAt;
          data.settings.ai.lastError = null;
          data.settings.ai.cooldownUntil = null;
          data.settings.ai.totalRequests = (data.settings.ai.totalRequests || 0) + 1;
        });
        sendJson(res, 200, {
          ok: true,
          provider: providerId,
          model: result.model,
          latencyMs: result.latencyMs,
          usage: result.usage,
          note: 'Connection test succeeded. Nothing was saved; use Save settings to keep this configuration.'
        });
      } catch (error) {
        await recordAiFailure(store, error, apiKey);
        throw new HttpError(error?.status === 429 || error?.code === 'RATE_LIMITED' || error?.quotaExhausted ? 429 : 502, safeError(error, apiKey));
      }
      return;
    }

    if (pathname === '/api/settings/ai/models' && method === 'POST') {
      const body = await readJson(req);
      const state = store.get();
      const current = state.settings.ai;
      const providerId = String(body.provider || current.provider || 'gemini');
      const provider = PROVIDERS[providerId];
      if (!provider) throw new HttpError(400, `Unknown AI provider: ${providerId}`);
      const apiKey = String(body.apiKey || '').trim() || decryptString(current.apiKeyEnc, secret);
      if (!apiKey) throw new HttpError(400, 'Add an API key first.');
      const baseUrl = String(body.baseUrl || (providerId === current.provider ? current.baseUrl : '') || provider.baseUrl || '').trim();
      try {
        let models = await listModels({ providerId, apiKey, baseUrl });
        if (providerId === 'openrouter') models = models.filter((model) => String(model.id).endsWith(':free'));
        sendJson(res, 200, { models: models.slice(0, 300) });
      } catch (error) {
        throw new HttpError(error?.status === 429 ? 429 : 502, safeError(error, apiKey));
      }
      return;
    }

    if (pathname === '/api/search' && method === 'POST') {
      const state = store.get();
      if (getActiveRunId()) {
        throw new HttpError(409, 'A search is already running. Wait for it to finish.');
      }
      if (!state.profile) throw new HttpError(400, 'Upload a resume before searching.');
      const enabled = (state.preferences.enabledSources || []).filter((id) => CONNECTORS[id]);
      if (!enabled.length) throw new HttpError(400, 'Enable at least one job source in Preferences.');
      const runId = crypto.randomUUID();
      runSearch({
        store,
        logger,
        secret,
        reason: 'manual',
        runId,
        onRunCreated: (run) => broadcast({ type: 'run', run }),
        onProgress: (run) => broadcast({ type: 'run', run })
      }).catch((error) => {
        logger.error('Manual search failed', { error: error.message, code: error.code });
        broadcast({ type: 'run-error', runId, error: String(error.message || error) });
      });
      sendJson(res, 202, { runId, status: 'started' });
      return;
    }

    if (pathname === '/api/runs' && method === 'GET') {
      const active = getActiveRun();
      const runs = store.get().runs.map(publicRun);
      if (active && !runs.some((run) => run.id === active.id)) runs.unshift(publicRun(active));
      sendJson(res, 200, { runs });
      return;
    }

    if (pathname === '/api/runs' && method === 'DELETE') {
      await store.update((data) => {
        data.runs = [];
      });
      sendJson(res, 200, { cleared: true });
      return;
    }

    const runMatch = pathname.match(RUN_ROUTE);
    if (runMatch && method === 'GET') {
      sendJson(res, 200, { run: publicRun(runById(store, decodeURIComponent(runMatch[1]))) });
      return;
    }

    if (pathname === '/api/manual-links' && method === 'GET') {
      const data = store.get();
      sendJson(res, 200, publicManualLinks(data.profile, data.preferences));
      return;
    }

    if (pathname === '/api/export' && method === 'GET') {
      const data = await store.export();
      const body = JSON.stringify({
        app: 'JobScout',
        version: config.version,
        exportedAt: new Date().toISOString(),
        data: exportPayload(data)
      }, null, 2);
      res.writeHead(200, {
        ...securityHeaders(),
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="jobscout-export-${new Date().toISOString().slice(0, 10)}.json"`,
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      res.end(body);
      return;
    }

    if (pathname === '/api/privacy/delete' && method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || 'resume');
      if (scope === 'everything') {
        await store.reset();
      } else if (scope === 'resume') {
        await store.update((data) => {
          data.profile = null;
          data.meta.lastProfileAt = null;
        });
      } else if (scope === 'jobs') {
        await store.update((data) => {
          data.jobs = [];
          data.runs = [];
          data.sourceState = {};
          data.meta.lastSearchAt = null;
          data.meta.lastSearchStatus = null;
        });
      } else {
        throw new HttpError(400, 'Unknown delete scope.');
      }
      sendJson(res, 200, buildState(store));
      return;
    }

    throw new HttpError(404, 'API route not found.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || `${config.host}:${config.port}`;
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204, securityHeaders());
        res.end();
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : (error?.status || 500);
      if (status >= 500) logger.error('Request failed', { method: req.method, url: req.url, error: error.message });
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, status, {
        error: status >= 500 && !(error instanceof HttpError) ? 'Internal server error.' : String(error.message || 'Request failed'),
        code: error?.code || ''
      });
    }
  });

  async function close() {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, store, logger, secret, broadcast, close };
}

export async function startServer({
  dataDir = config.dataDir,
  port = config.port,
  host = config.host,
  schedulerEnabled = true,
  logger: providedLogger = null
} = {}) {
  const store = await new Store(dataDir).init();
  const logger = providedLogger || createLogger(dataDir);
  const secret = loadOrCreateSecret(dataDir);
  const app = createApp({ store, logger, secret });
  const scheduler = schedulerEnabled
    ? startScheduler({ store, logger, secret, onEvent: (event) => app.broadcast(event) })
    : null;
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  logger.info(`JobScout is running at http://${host}:${actualPort}`);
  return {
    ...app,
    scheduler,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async stop() {
      scheduler?.stop();
      await app.close();
    }
  };
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  startServer().then((app) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      app.logger.info('Shutting down JobScout.');
      try {
        await app.stop();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    console.error(`JobScout failed to start: ${error.message}`);
    process.exit(1);
  });
}
