import { stripHtml, normalizeWhitespace, canonicalUrl, parseDate, hashText, titleSimilarity, daysSince, oneLine, uniqueStrings } from '../../lib/util.js';
import { detectWorkMode, detectCountry, normalizeLocation } from '../../matching/location.js';
import { inferExperienceFromTitle } from '../../matching/extract.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'job', 'role', 'senior', 'junior', 'lead', 'staff', 'principal', 'remote', 'hybrid', 'onsite', 'on-site', 'india', 'engineer', 'developer']);

export function titleMatches(jobTitle, titles = []) {
  if (!titles.length) return true;
  const title = String(jobTitle || '').toLowerCase();
  for (const preferred of titles) {
    if (!preferred) continue;
    if (titleSimilarity(preferred, jobTitle) >= 0.28) return true;
    const tokens = String(preferred).toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 2 && !STOP.has(t));
    if (tokens.some((token) => title.includes(token))) return true;
  }
  return false;
}

export function locationMatches(job, preferences = {}) {
  const locations = (preferences.locations || []).filter(Boolean);
  const countries = (preferences.countries || []).filter(Boolean);
  if (!locations.length && !countries.length) return true;
  if (job.workMode === 'remote') return true;
  const text = `${job.location || ''} ${job.country || ''}`.toLowerCase();
  if (!text.trim() || /not specified|unknown/.test(text)) return true;
  if (locations.some((loc) => text.includes(String(loc).toLowerCase()))) return true;
  if (countries.some((country) => text.includes(String(country).toLowerCase()))) return true;
  if (countries.some((country) => detectCountry(text) === country)) return true;
  return false;
}

export function companyAllowed(company, preferences = {}) {
  const name = String(company || '').toLowerCase();
  const excludes = (preferences.excludeCompanies || []).map((c) => String(c).toLowerCase()).filter(Boolean);
  if (excludes.some((c) => name.includes(c))) return false;
  const includes = (preferences.includeCompanies || []).map((c) => String(c).toLowerCase()).filter(Boolean);
  if (includes.length && !includes.some((c) => name.includes(c))) return false;
  return true;
}

export function prefilter(raw, ctx) {
  if (!raw.title || !raw.company || !raw.url) return false;
  if (!companyAllowed(raw.company, ctx.preferences)) return false;
  if (!titleMatches(raw.title, ctx.titles)) return false;
  const workMode = detectWorkMode({
    title: raw.title,
    location: raw.location || '',
    description: raw.description || '',
    hint: raw.workModeHint || ''
  });
  if (!locationMatches({ ...raw, workMode }, ctx.preferences)) return false;
  if (raw.postedAt) {
    const age = daysSince(raw.postedAt);
    if (age != null && age > (ctx.preferences.maxAgeDays || 60)) return false;
  }
  return true;
}

export function rankForQuery(raw, ctx) {
  let score = 0;
  for (const title of ctx.titles || []) {
    score = Math.max(score, titleSimilarity(title, raw.title));
  }
  if (raw.postedAt) {
    const age = daysSince(raw.postedAt);
    if (age != null) score += Math.max(0, 0.2 - age / 500);
  }
  if (raw.salaryText) score += 0.05;
  return score;
}

export function limitRanked(jobs, limit) {
  return jobs
    .map((job, index) => ({ job, index, rank: job.__rank || 0 }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.job);
}

export function normalizeRawJob(raw, ctx) {
  if (!raw?.title || !raw?.company || !raw?.url) return null;
  const description = normalizeWhitespace(stripHtml(raw.description || '')).slice(0, 24000);
  const title = oneLine(raw.title, 220);
  const company = oneLine(raw.company, 160);
  const location = oneLine(raw.location || 'Not specified', 180);
  const workMode = detectWorkMode({
    title,
    location,
    description,
    hint: raw.workModeHint || ''
  });
  const postedAt = parseDate(raw.postedAt) || null;
  const salaryText = raw.salaryText ? oneLine(raw.salaryText, 160) : '';
  const sourceId = raw.sourceId || `${raw.source}:${raw.requisitionId || raw.url}`;
  const canonical = canonicalUrl(raw.url);
  const country = raw.country || detectCountry(location) || detectCountry(description.slice(0, 2000)) || '';
  const exp = inferExperienceFromTitle(title);
  return {
    id: hashText(sourceId),
    sourceId,
    source: raw.source,
    sourceLabel: raw.sourceLabel || raw.source,
    board: raw.board || '',
    title,
    company,
    location,
    country,
    workMode,
    remote: workMode === 'remote' || Boolean(raw.remote),
    employmentType: raw.employmentType ? oneLine(raw.employmentType, 80) : '',
    experienceRequired: raw.experienceRequired || (exp ? exp.text : ''),
    salaryText,
    description,
    summary: raw.summary ? oneLine(raw.summary, 320) : '',
    url: raw.url,
    canonicalUrl: canonical,
    requisitionId: raw.requisitionId ? String(raw.requisitionId).slice(0, 120) : '',
    postedAt,
    firstSeenAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    active: true,
    expiredAt: null,
    tags: uniqueStrings(raw.tags || []).slice(0, 30),
    attribution: raw.attribution || '',
    descriptionHash: hashText(`${company}|${title}|${description.slice(0, 4000)}`),
    sourceMeta: raw.sourceMeta || {}
  };
}

export function finalizeSourceJobs(rawJobs, ctx, limit, warnings = [], scanned = null) {
  const normalized = [];
  const seen = new Set();
  for (const raw of rawJobs) {
    if (!prefilter(raw, ctx)) continue;
    raw.__rank = rankForQuery(raw, ctx);
    const job = normalizeRawJob(raw, ctx);
    if (!job) continue;
    if (seen.has(job.sourceId) || seen.has(job.canonicalUrl)) continue;
    seen.add(job.sourceId);
    seen.add(job.canonicalUrl);
    normalized.push(job);
  }
  return {
    jobs: limitRanked(normalized, limit),
    scanned: Number.isFinite(scanned) ? scanned : rawJobs.length,
    warnings
  };
}

export function salaryTextFromRange(range) {
  if (!range) return '';
  if (typeof range === 'string') return range;
  const min = range.min ?? range.minimum;
  const max = range.max ?? range.maximum;
  const currency = range.currency || '';
  const interval = range.interval || range.period || '';
  if (min == null && max == null) return '';
  if (min != null && max != null && min !== max) return `${currency} ${min}–${max}${interval ? ` / ${interval}` : ''}`.trim();
  return `${currency} ${min ?? max}${interval ? ` / ${interval}` : ''}`.trim();
}

export function detectEmploymentType(value) {
  const text = String(value || '').toLowerCase();
  if (/intern/.test(text)) return 'Internship';
  if (/part[-_ ]?time/.test(text)) return 'Part-time';
  if (/contract|temporary|temp\b|freelance/.test(text)) return 'Contract';
  if (/full[-_ ]?time|permanent|regular/.test(text)) return 'Full-time';
  return value ? String(value).slice(0, 60) : '';
}

export function workModeHint(value) {
  const text = String(value || '').toLowerCase();
  if (/hybrid/.test(text)) return 'hybrid';
  if (/remote|telecommut|distributed/.test(text)) return 'remote';
  if (/on-?site|office|in-person/.test(text)) return 'onsite';
  return '';
}

export function normalizeLocationText(city, state, country) {
  return [city, state, country].filter(Boolean).join(', ');
}

export { normalizeLocation };
