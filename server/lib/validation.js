import { encryptString } from './crypto.js';
import { HttpError } from './http.js';
import { CONNECTORS, MANUAL_SOURCES } from '../jobs/registry.js';
import { PROVIDERS } from '../ai/providers.js';
import { uniqueStrings, clamp } from './util.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WORK_MODES = new Set(['remote', 'hybrid', 'onsite']);
const EXPERIENCE_LEVELS = new Set(['intern', 'entry', 'junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'executive']);
const SOURCE_IDS = new Set(Object.keys(CONNECTORS));

function list(value, { max = 100, maxLength = 120 } = {}) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/\n|,/);
  return uniqueStrings(values)
    .map((item) => item.slice(0, maxLength))
    .slice(0, max);
}

function tokenList(value, max = 80) {
  return list(value, { max, maxLength: 80 })
    .map((item) => item.replace(/[^A-Za-z0-9._-]/g, ''))
    .filter(Boolean);
}

function urlList(value, max = 30) {
  const out = [];
  for (const raw of list(value, { max: max * 2, maxLength: 500 })) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      out.push(url.toString());
    } catch {
      // Invalid URLs are rejected below when nothing valid remains.
    }
  }
  if (out.length > max) out.length = max;
  return out;
}

function validTimezone(value) {
  const timezone = String(value || '').trim().slice(0, 80);
  if (!timezone) return 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new HttpError(400, `Unknown time zone: ${timezone}`);
  }
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function sanitizeBoards(input, current = {}) {
  const next = { ...current };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return next;

  for (const key of ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters']) {
    if (has(input, key)) next[key] = tokenList(input[key], 80);
  }
  if (has(input, 'workday')) {
    const values = Array.isArray(input.workday) ? input.workday : [];
    next.workday = values.slice(0, 60).map((item) => ({
      tenant: String(item?.tenant || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80),
      wd: String(item?.wd || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12),
      site: String(item?.site || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120),
      label: String(item?.label || '').slice(0, 80)
    })).filter((item) => item.tenant && /^wd\d+$/.test(item.wd) && item.site);
  }
  if (has(input, 'custom')) {
    const urls = urlList(input.custom, 30);
    if (list(input.custom, { max: 30 }).length && !urls.length) {
      throw new HttpError(400, 'Career page URLs must be valid http(s) URLs.');
    }
    next.custom = urls;
  }
  return next;
}

export function sanitizePreferences(input = {}, current = {}, { secret } = {}) {
  const next = structuredClone(current);
  next.adzuna = { ...(next.adzuna || {}), appKey: '' };
  next.boards = { ...(next.boards || {}) };

  if (has(input, 'titles')) next.titles = list(input.titles, { max: 12, maxLength: 120 });
  if (has(input, 'locations')) next.locations = list(input.locations, { max: 20, maxLength: 120 });
  if (has(input, 'countries')) next.countries = list(input.countries, { max: 30, maxLength: 80 });
  if (has(input, 'workModes')) {
    next.workModes = list(input.workModes, { max: 3, maxLength: 20 })
      .filter((mode) => WORK_MODES.has(mode));
  }
  if (has(input, 'experienceLevels')) {
    next.experienceLevels = list(input.experienceLevels, { max: 9, maxLength: 20 })
      .filter((level) => EXPERIENCE_LEVELS.has(level));
  }
  if (has(input, 'employmentTypes')) next.employmentTypes = list(input.employmentTypes, { max: 10, maxLength: 60 });
  if (has(input, 'technologies')) next.technologies = list(input.technologies, { max: 60, maxLength: 80 });
  if (has(input, 'includeCompanies')) next.includeCompanies = list(input.includeCompanies, { max: 50, maxLength: 120 });
  if (has(input, 'excludeCompanies')) next.excludeCompanies = list(input.excludeCompanies, { max: 50, maxLength: 120 });
  if (has(input, 'industries')) next.industries = list(input.industries, { max: 30, maxLength: 80 });

  if (has(input, 'minSalary')) {
    const value = input.minSalary;
    const number = Number(value);
    next.minSalary = value === '' || value == null || !Number.isFinite(number) || number < 0 ? null : Math.round(number);
  }
  if (has(input, 'currency')) next.currency = String(input.currency || 'INR').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'INR';
  if (has(input, 'maxResults')) next.maxResults = Math.round(clamp(Number(input.maxResults) || 150, 20, 500));
  if (has(input, 'maxAgeDays')) next.maxAgeDays = Math.round(clamp(Number(input.maxAgeDays) || 45, 1, 365));

  if (has(input, 'dailyEnabled')) next.dailyEnabled = Boolean(input.dailyEnabled);
  if (has(input, 'dailyTime')) {
    const time = String(input.dailyTime || '').trim();
    if (!TIME_RE.test(time)) throw new HttpError(400, 'Daily search time must be HH:MM in 24-hour format.');
    next.dailyTime = time;
  }
  if (has(input, 'dailyTimezone')) next.dailyTimezone = validTimezone(input.dailyTimezone);

  if (has(input, 'enabledSources')) {
    const requested = list(input.enabledSources, { max: 30, maxLength: 40 });
    next.enabledSources = requested.filter((id) => SOURCE_IDS.has(id));
  }

  if (has(input, 'boards')) next.boards = sanitizeBoards(input.boards, next.boards);
  if (has(input, 'adzuna')) {
    const adzuna = input.adzuna || {};
    if (has(adzuna, 'appId')) next.adzuna.appId = String(adzuna.appId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 80);
    if (has(adzuna, 'country')) next.adzuna.country = String(adzuna.country || 'in').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'in';
  }

  let credentialPatch = null;
  if (input.clearAdzunaKey) {
    credentialPatch = { adzunaAppKeyEnc: null };
  } else if (has(input, 'adzunaAppKey') && String(input.adzunaAppKey || '').trim()) {
    const key = String(input.adzunaAppKey).trim().slice(0, 200);
    if (!next.adzuna.appId) throw new HttpError(400, 'Add the Adzuna app ID together with the app key.');
    credentialPatch = { adzunaAppKeyEnc: encryptString(key, secret) };
  }

  // The plaintext app key is never stored in preferences.
  next.adzuna.appKey = '';
  return { preferences: next, credentialPatch };
}

export function sanitizeSettings(input = {}, current = {}, { secret } = {}) {
  const next = structuredClone(current);
  const aiInput = input.ai && typeof input.ai === 'object' ? input.ai : input;
  const ai = { ...(next.ai || {}) };
  const previousProvider = ai.provider;
  const providerChanged = has(aiInput, 'provider') && aiInput.provider !== previousProvider;

  if (has(aiInput, 'provider')) {
    const provider = String(aiInput.provider || '').trim();
    if (!PROVIDERS[provider]) throw new HttpError(400, `Unknown AI provider: ${provider}`);
    ai.provider = provider;
    if (providerChanged && !has(aiInput, 'model')) ai.model = PROVIDERS[provider].defaultModel;
  }
  if (has(aiInput, 'model')) ai.model = String(aiInput.model || '').trim().slice(0, 160);
  if (!ai.model) ai.model = PROVIDERS[ai.provider]?.defaultModel || '';
  if (has(aiInput, 'baseUrl')) {
    const baseUrl = String(aiInput.baseUrl || '').trim().slice(0, 500);
    if (baseUrl) {
      try {
        const url = new URL(baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
      } catch {
        throw new HttpError(400, 'AI base URL must be a valid http(s) URL.');
      }
    }
    ai.baseUrl = baseUrl;
  }
  if (ai.provider === 'custom' && !ai.baseUrl) throw new HttpError(400, 'A custom OpenAI-compatible provider needs a base URL.');

  if (ai.provider === 'openrouter' && ai.model && !ai.model.endsWith(':free')) {
    throw new HttpError(400, 'OpenRouter is free-only in JobScout. Choose a model whose ID ends with :free.');
  }

  let keyChanged = false;
  if (aiInput.clearKey) {
    ai.apiKeyEnc = null;
    keyChanged = true;
  } else if (has(aiInput, 'apiKey') && String(aiInput.apiKey || '').trim()) {
    ai.apiKeyEnc = encryptString(String(aiInput.apiKey).trim(), secret);
    keyChanged = true;
  } else if (providerChanged) {
    // Never send a key saved for one provider to a different provider.
    ai.apiKeyEnc = null;
    keyChanged = true;
  }

  if (has(aiInput, 'enabled')) ai.enabled = Boolean(aiInput.enabled);
  // A cleared or provider-switched key cannot leave AI enabled by accident.
  // Re-enabling requires an explicit enabled flag and a saved key.
  if (!ai.apiKeyEnc && !has(aiInput, 'enabled')) ai.enabled = false;
  if (ai.enabled && !ai.apiKeyEnc) throw new HttpError(400, 'Add an API key before enabling AI.');
  ai.freeOnly = true;
  if (keyChanged || providerChanged || has(aiInput, 'model')) {
    ai.cooldownUntil = null;
    ai.lastError = null;
  }
  next.ai = ai;

  if (input.privacy && typeof input.privacy === 'object') {
    next.privacy = {
      ...(next.privacy || {}),
      sendFullResumeText: input.privacy.sendFullResumeText == null ? next.privacy?.sendFullResumeText : Boolean(input.privacy.sendFullResumeText),
      keepResumeText: input.privacy.keepResumeText == null ? next.privacy?.keepResumeText : Boolean(input.privacy.keepResumeText)
    };
  }
  return next;
}

export function publicPreferences(preferences, settings) {
  const out = structuredClone(preferences);
  out.adzuna = {
    appId: preferences.adzuna?.appId || '',
    country: preferences.adzuna?.country || 'in',
    hasAppKey: Boolean(settings?.credentials?.adzunaAppKeyEnc)
  };
  return out;
}

export function publicManualLinks(profile, preferences) {
  const titles = uniqueStrings([
    ...(preferences?.titles || []),
    ...(profile?.suggestedTitles || [])
  ]).slice(0, 6);
  const queryTitles = titles.length ? titles : ['Software Engineer'];
  const location = (preferences?.locations || [])[0]
    || (preferences?.countries || [])[0]
    || profile?.location
    || 'India';
  return {
    titles: queryTitles,
    location,
    sources: MANUAL_SOURCES.map((source) => ({
      id: source.id,
      label: source.label,
      reason: source.reason,
      url: source.searchUrl(queryTitles[0], location)
    }))
  };
}

function matchesStatus(job, statuses) {
  const status = job.status || 'new';
  if (statuses.has('all')) return true;
  if (statuses.has('expired')) return job.active === false;
  if (job.active === false && !statuses.has('expired')) return false;
  return statuses.has(status);
}

export function filterJobs(jobs, params = {}) {
  const statusParam = String(params.status || '').trim();
  const statuses = new Set(statusParam ? statusParam.split(',').map((s) => s.trim()).filter(Boolean) : []);
  if (!statuses.size) {
    statuses.add('new');
    statuses.add('saved');
    statuses.add('applied');
  }
  const sources = new Set(String(params.source || '').split(',').map((s) => s.trim()).filter(Boolean));
  const modes = new Set(String(params.workMode || '').split(',').map((s) => s.trim()).filter(Boolean));
  const q = String(params.q || '').trim().toLowerCase();
  const country = String(params.country || '').trim().toLowerCase();
  const minScore = params.minScore === '' || params.minScore == null ? null : Number(params.minScore);
  const includeExpired = params.includeExpired === '1' || params.includeExpired === 'true' || statuses.has('expired');
  const sort = String(params.sort || 'score');

  const filtered = jobs.filter((job) => {
    if (!includeExpired && job.active === false) return false;
    if (!matchesStatus(job, statuses)) return false;
    if (sources.size) {
      const jobSources = new Set([job.source, ...(job.sources || []).map((s) => s.source)]);
      if (![...sources].some((source) => jobSources.has(source))) return false;
    }
    if (modes.size && !modes.has(job.workMode || 'unknown')) return false;
    if (country && String(job.country || '').toLowerCase() !== country) return false;
    if (Number.isFinite(minScore) && (job.match?.score || 0) < minScore) return false;
    if (q) {
      const haystack = [
        job.title,
        job.company,
        job.location,
        job.summary,
        ...(job.match?.matchedSkills || []),
        ...(job.match?.missingRequired || []),
        ...(job.signals?.requiredSkills || []).map((s) => s.name)
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'posted') return new Date(b.postedAt || 0) - new Date(a.postedAt || 0);
    if (sort === 'oldest') return new Date(a.postedAt || 0) - new Date(b.postedAt || 0);
    if (sort === 'newest') return new Date(b.firstSeenAt || 0) - new Date(a.firstSeenAt || 0);
    if (sort === 'verified') return new Date(b.lastVerifiedAt || 0) - new Date(a.lastVerifiedAt || 0);
    if (sort === 'company') return String(a.company || '').localeCompare(String(b.company || ''));
    if (sort === 'salary') return (b.salary?.min || 0) - (a.salary?.min || 0);
    return (b.match?.score || 0) - (a.match?.score || 0)
      || new Date(b.postedAt || 0) - new Date(a.postedAt || 0)
      || String(a.title || '').localeCompare(String(b.title || ''));
  });

  const limit = Math.round(clamp(Number(params.limit) || 50, 1, 200));
  const offset = Math.max(0, Math.round(Number(params.offset) || 0));
  return { total: sorted.length, jobs: sorted.slice(offset, offset + limit), limit, offset };
}
