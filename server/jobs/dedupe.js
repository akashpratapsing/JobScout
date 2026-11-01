import { canonicalUrl, hashText, jaccard, titleSimilarity } from '../lib/util.js';
import { canonicalCity, detectCountry } from '../matching/location.js';

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|pvt|private|plc|corp|corporation|co|gmbh|ag|sa|sas|bv|nv|oy|ab|as|pte|sdn|bhd|technologies|technology|tech|solutions|services|group|holdings)\b\.?/gi;

export function normalizeCompany(name) {
  const original = String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = original
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || original;
}

export function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(m\/f\/d|m\/w\/d|f\/m\/d|all genders|remote|hybrid|on-?site)\b/g, ' ')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocationKey(location) {
  const city = canonicalCity(location);
  const country = detectCountry(location);
  if (city || country) return `${city || ''}|${country || ''}`;
  return String(location || '')
    .toLowerCase()
    .replace(/\b(remote|hybrid|on-?site|anywhere|worldwide)\b/g, ' ')
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function requisitionKey(job) {
  const req = String(job.requisitionId || '').trim().toLowerCase();
  if (!req) return '';
  return `req|${normalizeCompany(job.company)}|${req}`;
}

export function signatureKey(job) {
  return `sig|${normalizeCompany(job.company)}|${normalizeTitleKey(job.title)}|${normalizeLocationKey(job.location)}`;
}

export function locationOverlap(a, b) {
  const ka = normalizeLocationKey(a);
  const kb = normalizeLocationKey(b);
  if (!ka || !kb) return true;
  if (ka === kb) return true;
  const [cityA, countryA] = ka.split('|');
  const [cityB, countryB] = kb.split('|');
  if (cityA && cityB && cityA === cityB) return true;
  if (countryA && countryB && countryA === countryB && (!cityA || !cityB)) return true;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  return false;
}

export function isDuplicate(existing, incoming) {
  if (!existing || !incoming) return false;
  if (normalizeCompany(existing.company) !== normalizeCompany(incoming.company)) return false;

  const urlA = existing.canonicalUrl || canonicalUrl(existing.url);
  const urlB = incoming.canonicalUrl || canonicalUrl(incoming.url);
  if (urlA && urlB && urlA === urlB) return true;

  const reqA = String(existing.requisitionId || '').trim().toLowerCase();
  const reqB = String(incoming.requisitionId || '').trim().toLowerCase();
  if (reqA && reqB) {
    if (reqA === reqB) return true;
    // Two different requisition IDs are never the same job, even if the titles match.
    return false;
  }

  const sameSignature = signatureKey(existing) === signatureKey(incoming);
  if (!sameSignature) {
    const titleSim = titleSimilarity(existing.title, incoming.title);
    if (titleSim < 0.92) return false;
    if (!locationOverlap(existing.location, incoming.location)) return false;
    const descSim = jaccard(existing.description || '', incoming.description || '');
    return descSim >= 0.55;
  }

  if (!locationOverlap(existing.location, incoming.location)) return false;
  const descA = existing.description || '';
  const descB = incoming.description || '';
  if (!descA || !descB) return true;
  const similarity = jaccard(descA, descB);
  // Same company/title/location with a different requisition is only a duplicate
  // if the descriptions strongly agree; otherwise keep both.
  return similarity >= 0.45;
}

export function sourceRef(job) {
  return {
    source: job.source,
    sourceLabel: job.sourceLabel,
    board: job.board || '',
    url: job.url,
    canonicalUrl: job.canonicalUrl || canonicalUrl(job.url),
    requisitionId: job.requisitionId || '',
    postedAt: job.postedAt || null,
    lastVerifiedAt: job.lastVerifiedAt || new Date().toISOString(),
    active: job.active !== false
  };
}

const SOURCE_PRIORITY = {
  greenhouse: 1, lever: 1, ashby: 1, workday: 1, workable: 1, recruitee: 1, smartrecruiters: 1, custom: 2,
  remoteok: 4, remotive: 4, weworkremotely: 4, himalayas: 4, jobtech: 4, arbeitnow: 4, jobicy: 4, adzuna: 5
};

function priority(source) {
  return SOURCE_PRIORITY[source] ?? 3;
}

export function mergeJob(existing, incoming) {
  // Keep the existing primary source even when this job was never processed by
  // dedupeJobs(), so a merge can never drop the original attribution.
  const mergedSources = Array.isArray(existing.sources) && existing.sources.length
    ? [...existing.sources]
    : [sourceRef(existing)];
  const addSource = (job) => {
    const ref = sourceRef(job);
    const found = mergedSources.find((s) => (s.canonicalUrl && s.canonicalUrl === ref.canonicalUrl) || (s.source === ref.source && s.requisitionId && s.requisitionId === ref.requisitionId));
    if (found) {
      found.lastVerifiedAt = latest(found.lastVerifiedAt, ref.lastVerifiedAt);
      found.active = ref.active;
      if (!found.url) found.url = ref.url;
    } else {
      mergedSources.push(ref);
    }
  };

  addSource(incoming);

  const swapPrimary = priority(incoming.source) < priority(existing.source) && incoming.description?.length > (existing.description?.length || 0) * 0.6;
  if (swapPrimary) {
    const oldPrimary = sourceRef(existing);
    const oldId = existing.id;
    const oldFirstSeen = existing.firstSeenAt;
    const oldStatus = existing.status;
    const oldMatch = existing.match;
    const oldNotes = existing.notes;
    Object.assign(existing, incoming, {
      id: oldId,
      firstSeenAt: oldFirstSeen,
      status: oldStatus,
      match: oldMatch,
      notes: oldNotes,
      sources: mergedSources,
      lastVerifiedAt: latest(existing.lastVerifiedAt, incoming.lastVerifiedAt)
    });
    const already = mergedSources.find((s) => s.canonicalUrl === oldPrimary.canonicalUrl);
    if (!already) mergedSources.push(oldPrimary);
  } else {
    existing.lastVerifiedAt = latest(existing.lastVerifiedAt, incoming.lastVerifiedAt);
    existing.postedAt = earliest(existing.postedAt, incoming.postedAt);
    existing.active = existing.active !== false || incoming.active !== false;
    existing.title = existing.title || incoming.title;
    existing.company = existing.company || incoming.company;
    existing.location = existing.location && existing.location !== 'Not specified' ? existing.location : incoming.location;
    existing.workMode = existing.workMode === 'unknown' ? incoming.workMode : existing.workMode;
    existing.remote = existing.remote || incoming.remote;
    existing.employmentType = existing.employmentType || incoming.employmentType;
    existing.experienceRequired = existing.experienceRequired || incoming.experienceRequired;
    existing.salaryText = existing.salaryText || incoming.salaryText;
    existing.requisitionId = existing.requisitionId || incoming.requisitionId;
    existing.country = existing.country || incoming.country;
    if ((incoming.description?.length || 0) > (existing.description?.length || 0) * 1.1) {
      existing.description = incoming.description;
      existing.descriptionHash = incoming.descriptionHash;
    }
    existing.tags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])].slice(0, 30);
  }

  existing.sources = mergedSources;
  existing.active = existing.active !== false;
  existing.duplicateCount = Math.max(0, mergedSources.length - 1);
  existing.updatedAt = new Date().toISOString();
  return existing;
}

function latest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function earliest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

export function dedupeJobs(existingJobs, incomingJobs) {
  const jobs = [...existingJobs];
  let added = 0;
  let merged = 0;
  const mergedIds = new Set();

  for (const incoming of incomingJobs) {
    let found = null;
    for (const existing of jobs) {
      if (mergedIds.has(existing.id) && existing.id !== incoming.id) {
        // Still allow matching against a job that was merged in this pass.
      }
      if (isDuplicate(existing, incoming)) {
        found = existing;
        break;
      }
    }
    if (found) {
      mergeJob(found, incoming);
      mergedIds.add(found.id);
      merged += 1;
    } else {
      jobs.push({ ...incoming, sources: [sourceRef(incoming)], duplicateCount: 0 });
      added += 1;
    }
  }

  return { jobs, added, merged };
}

export function descriptionFingerprint(job) {
  return hashText(`${normalizeCompany(job.company)}|${normalizeTitleKey(job.title)}|${(job.description || '').slice(0, 4000)}`);
}
