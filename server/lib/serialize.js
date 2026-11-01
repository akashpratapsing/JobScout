import { PROVIDERS } from '../ai/providers.js';
import { profileCompleteness } from '../resume.js';

export function publicProfile(profile) {
  if (!profile) return null;
  const { rawText, ...rest } = profile;
  return {
    ...rest,
    hasResumeText: Boolean(rawText),
    resumeTextChars: rawText?.length || 0,
    completeness: profileCompleteness(profile)
  };
}

export function publicSettings(settings, { hasKey = false } = {}) {
  const ai = settings.ai || {};
  return {
    ai: {
      provider: ai.provider,
      model: ai.model,
      baseUrl: ai.baseUrl || '',
      enabled: Boolean(ai.enabled),
      freeOnly: ai.freeOnly !== false,
      hasKey,
      cooldownUntil: ai.cooldownUntil || null,
      lastError: ai.lastError || null,
      lastSuccessAt: ai.lastSuccessAt || null,
      lastTestAt: ai.lastTestAt || null,
      totalRequests: ai.totalRequests || 0,
      totalInputTokens: ai.totalInputTokens || 0,
      totalOutputTokens: ai.totalOutputTokens || 0
    },
    privacy: settings.privacy || {},
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      keyUrl: p.keyUrl,
      docsUrl: p.docsUrl,
      freeNote: p.freeNote,
      kind: p.kind,
      freeOnly: Boolean(p.freeOnly)
    }))
  };
}

export function publicJob(job, { full = false } = {}) {
  if (!job) return null;
  const out = {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    country: job.country || '',
    workMode: job.workMode || 'unknown',
    remote: Boolean(job.remote),
    employmentType: job.employmentType || '',
    experienceRequired: job.experienceRequired || '',
    salaryText: job.salaryText || '',
    salary: job.salary || null,
    summary: job.summary || '',
    description: full ? job.description : (job.description || '').slice(0, 900),
    url: job.url,
    source: job.source,
    sourceLabel: job.sourceLabel,
    board: job.board || '',
    requisitionId: job.requisitionId || '',
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    lastVerifiedAt: job.lastVerifiedAt,
    active: job.active !== false,
    expiredAt: job.expiredAt || null,
    expiredReason: job.expiredReason || '',
    status: job.status || 'new',
    notes: job.notes || '',
    statusHistory: job.statusHistory || [],
    savedAt: job.savedAt || null,
    appliedAt: job.appliedAt || null,
    dismissedAt: job.dismissedAt || null,
    tags: job.tags || [],
    sources: job.sources || [],
    duplicateCount: job.duplicateCount || 0,
    attribution: job.attribution || '',
    match: job.match || null,
    signals: full ? job.signals : compactSignals(job.signals),
    requiredSkills: job.signals?.requiredSkills?.map((s) => s.name) || [],
    preferredSkills: job.signals?.preferredSkills?.map((s) => s.name) || [],
    aiPending: job.match?.method === 'rules' && job.match?.aiPending === true
  };
  return out;
}

function compactSignals(signals) {
  if (!signals) return null;
  return {
    experience: signals.experience,
    seniority: signals.seniority,
    workMode: signals.workMode,
    salary: signals.salary,
    degreeRequired: signals.degreeRequired,
    summary: signals.summary
  };
}

export function jobStats(jobs) {
  const active = jobs.filter((j) => j.active !== false);
  const weekAgo = Date.now() - 7 * 86400000;
  return {
    total: jobs.length,
    active: active.length,
    strong: active.filter((j) => (j.match?.score || 0) >= 80).length,
    good: active.filter((j) => (j.match?.score || 0) >= 60 && (j.match?.score || 0) < 80).length,
    saved: jobs.filter((j) => j.status === 'saved').length,
    applied: jobs.filter((j) => j.status === 'applied').length,
    dismissed: jobs.filter((j) => j.status === 'dismissed').length,
    newThisWeek: active.filter((j) => new Date(j.firstSeenAt || 0).getTime() >= weekAgo).length,
    expired: jobs.filter((j) => j.active === false).length,
    aiScored: active.filter((j) => j.match?.method === 'ai').length,
    rulesScored: active.filter((j) => j.match?.method !== 'ai').length
  };
}
