import { config } from '../lib/config.js';
import { decryptString } from '../lib/crypto.js';
import { PROVIDERS, AiError, callAi, parseJsonResponse } from './providers.js';
import { RESUME_SYSTEM_PROMPT, MATCH_SYSTEM_PROMPT, resumeUserPrompt, matchUserPrompt } from './prompts.js';
import { canonicalSkills, suggestTitles } from '../matching/skills.js';
import { normalizeAiMatch } from '../matching/score.js';
import { inferCandidateLevel } from '../matching/score.js';
import { normalizeProfileInput, summarizeProfileForAi } from '../resume.js';
import { sleep, oneLine } from '../lib/util.js';

export function getAiRuntime(store, secret) {
  const settings = store.get().settings.ai;
  const provider = PROVIDERS[settings.provider] || PROVIDERS.gemini;
  const apiKey = decryptString(settings.apiKeyEnc, secret);
  return {
    providerId: provider.id,
    provider,
    model: settings.model || provider.defaultModel,
    apiKey,
    baseUrl: settings.baseUrl || provider.baseUrl,
    enabled: Boolean(settings.enabled && apiKey),
    cooldownUntil: settings.cooldownUntil,
    settings,
    store
  };
}

export function isCoolingDown(store) {
  const until = store.get().settings.ai.cooldownUntil;
  return until && new Date(until).getTime() > Date.now() ? until : null;
}

export async function recordAiSuccess(store, usage = {}) {
  await store.update((data) => {
    const ai = data.settings.ai;
    ai.lastSuccessAt = new Date().toISOString();
    ai.lastError = null;
    ai.cooldownUntil = null;
    ai.totalRequests = (ai.totalRequests || 0) + 1;
    ai.totalInputTokens = (ai.totalInputTokens || 0) + (usage.inputTokens || 0);
    ai.totalOutputTokens = (ai.totalOutputTokens || 0) + (usage.outputTokens || 0);
  });
}

export async function recordAiFailure(store, error, apiKey) {
  await store.update((data) => {
    const ai = data.settings.ai;
    const safe = sanitizeAiError(error, apiKey);
    ai.lastError = safe;
    if (error?.quotaExhausted) {
      const hours = error.retryAfter && error.retryAfter > 0 ? Math.min(24, Math.ceil(error.retryAfter / 3600)) : 6;
      ai.cooldownUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    } else if (error?.code === 'RATE_LIMITED') {
      const seconds = error.retryAfter && error.retryAfter > 0 ? Math.min(3600, error.retryAfter) : 60;
      ai.cooldownUntil = new Date(Date.now() + seconds * 1000).toISOString();
    }
  });
}

function sanitizeAiError(error, apiKey) {
  let text = String(error?.message || error || 'AI request failed');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.slice(0, 500);
}

export async function analyzeResumeWithAi({ text, heuristic, runtime }) {
  if (!runtime.enabled) throw new AiError('AI is not configured.', { provider: runtime.providerId, code: 'NO_KEY' });
  const result = await callAi({
    providerId: runtime.providerId,
    model: runtime.model,
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
    system: RESUME_SYSTEM_PROMPT,
    user: resumeUserPrompt(text, config.ai.maxResumeChars),
    json: true,
    maxOutputTokens: 3200
  });
  const parsed = parseJsonResponse(result.text);
  const profile = mergeResumeAnalysis(heuristic, parsed, {
    provider: runtime.providerId,
    model: result.model
  });
  return { profile, usage: result.usage, model: result.model, provider: runtime.providerId };
}

export function mergeResumeAnalysis(heuristic, ai, meta = {}) {
  const normalized = normalizeProfileInput(ai || {});
  const pickArray = (aiValue, fallback) => (Array.isArray(aiValue) && aiValue.length ? aiValue : fallback);
  const years = Number.isFinite(Number(ai?.experienceYears)) ? Math.max(0, Math.min(60, Number(ai.experienceYears))) : heuristic.experienceYears;
  const level = ['intern', 'entry', 'junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'executive'].includes(ai?.experienceLevel)
    ? ai.experienceLevel
    : (heuristic.experienceLevel || inferCandidateLevel(years));

  const profile = {
    ...heuristic,
    name: normalized.name || heuristic.name,
    email: normalized.email || heuristic.email,
    phone: normalized.phone || heuristic.phone,
    location: normalized.location || heuristic.location,
    headline: normalized.headline || heuristic.headline,
    summary: normalized.summary || heuristic.summary,
    skills: canonicalSkills([...(normalized.skills || []), ...(heuristic.skills || [])]).slice(0, 80),
    experienceYears: years,
    experienceLevel: level,
    experience: pickArray(normalized.experience, heuristic.experience),
    projects: pickArray(normalized.projects, heuristic.projects),
    education: pickArray(normalized.education, heuristic.education),
    certifications: pickArray(normalized.certifications, heuristic.certifications),
    keywords: canonicalSkills([...(normalized.keywords || []), ...(heuristic.keywords || [])]).slice(0, 80),
    suggestedTitles: pickArray(normalized.suggestedTitles, heuristic.suggestedTitles || suggestTitles(heuristic.skills || [], years || 0)),
    links: {
      ...heuristic.links,
      ...Object.fromEntries(Object.entries(normalized.links || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)))
    },
    analysis: {
      method: 'ai',
      provider: meta.provider || '',
      model: meta.model || '',
      at: new Date().toISOString(),
      note: 'AI-extracted. Review and correct anything that looks wrong.'
    }
  };
  return profile;
}

/**
 * Match a batch of jobs. Returns partial results plus a non-fatal error if the
 * provider hits a rate limit mid-run. The caller keeps rules-based scores for
 * any job that was not returned.
 */
export async function matchJobsWithAi({ jobs, profile, preferences, runtime, onProgress = () => {} }) {
  if (!runtime.enabled) throw new AiError('AI is not configured.', { provider: runtime.providerId, code: 'NO_KEY' });
  const compactProfile = summarizeProfileForAi(profile);
  const out = new Map();
  const batchSize = config.ai.jobsPerBatch;
  let completed = 0;
  let fatalError = null;

  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    try {
      const result = await callAi({
        providerId: runtime.providerId,
        model: runtime.model,
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        system: MATCH_SYSTEM_PROMPT,
        user: matchUserPrompt({ jobs: batch, profile: compactProfile, preferences }),
        json: true,
        maxOutputTokens: 2400
      });
      const parsed = parseJsonResponse(result.text);
      const matches = Array.isArray(parsed) ? parsed : parsed.matches;
      if (!Array.isArray(matches)) throw new AiError('AI response did not contain a matches array.', { provider: runtime.providerId, code: 'INVALID_SHAPE' });

      for (let index = 0; index < batch.length; index += 1) {
        const job = batch[index];
        const match = matches.find((m) => String(m?.id) === String(job.id)) || matches[index];
        if (!match) continue;
        out.set(job.id, {
          match: normalizeAiMatch(match, profile, preferences, job, job.signals),
          usage: result.usage,
          model: result.model
        });
      }
      completed += batch.length;
      onProgress({ completed: Math.min(completed, jobs.length), total: jobs.length, model: result.model });
      await recordAiSuccessForRuntime(runtime, result.usage);
    } catch (error) {
      fatalError = error;
      break;
    }
    if (i + batchSize < jobs.length) await sleep(1200);
  }

  return { matches: out, error: fatalError, completed, total: jobs.length };
}

// The runtime object holds a reference to the store so usage can be recorded
// without threading it through every call site.
async function recordAiSuccessForRuntime(runtime, usage) {
  if (runtime.store) await recordAiSuccess(runtime.store, usage);
}

export { oneLine };
