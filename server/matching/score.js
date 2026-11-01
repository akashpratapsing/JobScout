import { canonicalSkills, detectSkills, normalizeSkillName } from './skills.js';
import { locationEligibility, detectCountry } from './location.js';
import { seniorityGap, extractExperience } from './extract.js';
import { clamp, jaccard, titleSimilarity, oneLine } from '../lib/util.js';

export function collectProfileSkills(profile = {}) {
  const values = [
    ...(profile.skills || []),
    ...(profile.keywords || []),
    ...(profile.experience || []).flatMap((e) => e.technologies || []),
    ...(profile.projects || []).flatMap((p) => p.technologies || [])
  ];
  const canonical = canonicalSkills(values);
  // Also mine the local resume text if the profile has not been edited yet.
  if (profile.rawText) {
    for (const hit of detectSkills(profile.rawText).slice(0, 80)) {
      if (!canonical.some((s) => s.toLowerCase() === hit.name.toLowerCase())) canonical.push(hit.name);
    }
  }
  return canonical;
}

export function candidateYears(profile = {}) {
  if (Number.isFinite(Number(profile.experienceYears)) && Number(profile.experienceYears) >= 0) {
    return Number(profile.experienceYears);
  }
  const months = [];
  for (const item of profile.experience || []) {
    const start = parseMonth(item.start);
    const end = /present|current|now/i.test(item.end || '') ? new Date() : parseMonth(item.end);
    if (start && end && end >= start) months.push((end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()));
  }
  if (!months.length) return null;
  return Math.round((Math.max(...months) / 12) * 10) / 10;
}

function parseMonth(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/(\d{4})|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})/i);
  if (!match) return null;
  const year = Number(match[1] || match[2]);
  const monthMatch = text.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i);
  const month = monthMatch ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(monthMatch[0].toLowerCase().slice(0, 3)) : 0;
  return new Date(Date.UTC(year, month, 1));
}

export function buildRulesMatch(profile, preferences, job, signals) {
  const profileSkills = collectProfileSkills(profile);
  const profileSet = new Set(profileSkills.map((s) => s.toLowerCase()));
  const hasSkill = (name) => profileSet.has(String(name).toLowerCase());
  const years = candidateYears(profile);

  const required = signals.requiredSkills.map((s) => s.name);
  const preferred = signals.preferredSkills.map((s) => s.name);
  const mentioned = signals.mentionedSkills.map((s) => s.name);

  const matchedRequired = required.filter(hasSkill);
  const missingRequired = required.filter((s) => !hasSkill(s));
  const matchedPreferred = preferred.filter(hasSkill);
  const missingPreferred = preferred.filter((s) => !hasSkill(s));
  const otherMatched = mentioned.filter(hasSkill).filter((s) => !required.includes(s) && !preferred.includes(s));

  const requiredCoverage = required.length ? matchedRequired.length / required.length : 0;
  const preferredCoverage = preferred.length ? matchedPreferred.length / preferred.length : 0;
  const overallCoverage = mentioned.length ? mentioned.filter(hasSkill).length / mentioned.length : 0;

  const eligibility = locationEligibility({ job: { ...job, workMode: signals.workMode }, profile, preferences });
  const exp = signals.experience || {};
  const expMin = Number.isFinite(exp.min) ? exp.min : null;
  const expMax = Number.isFinite(exp.max) ? exp.max : null;
  const expGap = expMin != null && years != null ? expMin - years : null;
  const sGap = seniorityGap(profile.experienceLevel || inferCandidateLevel(years), signals.seniority);

  const preferredTitles = [...(preferences.titles || []), ...(profile.suggestedTitles || [])].filter(Boolean);
  let bestTitle = '';
  let bestTitleScore = 0;
  for (const title of preferredTitles) {
    const sim = titleSimilarity(title, job.title);
    if (sim > bestTitleScore) {
      bestTitleScore = sim;
      bestTitle = title;
    }
  }

  const modeAllowed = !preferences.workModes?.length || preferences.workModes.includes(signals.workMode) || signals.workMode === 'unknown';
  const eligibilityScore = eligibility.status === 'eligible' ? 10 : eligibility.status === 'possible' ? 6 : eligibility.status === 'restricted' ? 0 : 6;
  const locationScore = eligibilityScore * (modeAllowed ? 1 : 0.35);

  let experienceScore = 10;
  if (expMin != null) {
    if (years == null) experienceScore = 6;
    else if (years >= expMin) experienceScore = expMax != null && years > expMax + 5 ? 12 : 16;
    else if (expGap <= 1) experienceScore = 10;
    else if (expGap <= 2) experienceScore = 5;
    else experienceScore = 0;
  }

  let seniorityScore = 7;
  if (sGap <= 0) seniorityScore = sGap <= -2 ? 7 : 10;
  else if (sGap === 1) seniorityScore = 7;
  else if (sGap === 2) seniorityScore = 3;
  else seniorityScore = 0;

  const titleScore = preferredTitles.length ? bestTitleScore * 10 : 6;
  const educationMet = !signals.degreeRequired || (profile.education || []).length > 0;
  const educationScore = educationMet ? 3 : 0;

  const projectText = (profile.projects || []).map((p) => `${p.name || ''} ${p.description || ''} ${(p.technologies || []).join(' ')}`).join(' ');
  const projectOverlap = projectText ? jaccard(projectText, `${job.title} ${job.description || ''}`) : 0;
  const projectSkillMatches = (profile.projects || []).flatMap((p) => p.technologies || []).filter((tech) => {
    const name = normalizeSkillName(tech).toLowerCase();
    return required.concat(preferred, mentioned).some((s) => s.toLowerCase() === name);
  });
  const projectScore = profile.projects?.length ? clamp(projectOverlap * 8 + Math.min(2, projectSkillMatches.length * 0.5), 0, 3) : 0;

  let score =
    (required.length ? requiredCoverage * 38 : overallCoverage * 32) +
    (preferred.length ? preferredCoverage * 10 : overallCoverage * 6) +
    experienceScore +
    seniorityScore +
    titleScore +
    locationScore +
    educationScore +
    projectScore;

  score = Math.round(clamp(score, 0, 100));
  score = applyScoreCaps(score, {
    requiredCount: required.length,
    missingRequiredCount: missingRequired.length,
    requiredCoverage,
    eligibility: eligibility.status,
    expGap,
    seniorityGap: sGap,
    hasExplicitRequirements: required.length > 0
  });

  const confidence = required.length >= 3 && (job.description || '').length > 500 && exp.source === 'explicit'
    ? 'high'
    : required.length >= 1 && (job.description || '').length > 250
      ? 'medium'
      : 'low';

  const experienceAssessment = describeExperience(years, exp, expGap, signals.seniority);
  const locationAssessment = eligibility.reason;
  const verdict = buildVerdict(score, missingRequired, eligibility.status, expGap, sGap);
  const recommendation = eligibility.status === 'restricted' || missingRequired.length >= 2 || score < 55
    ? 'skip'
    : (missingRequired.length === 1 || score < 72) ? 'consider' : 'apply';
  const why = buildWhy({
    score,
    matchedRequired,
    matchedPreferred,
    missingRequired,
    missingPreferred,
    overallCoverage,
    required,
    experienceAssessment,
    locationAssessment,
    verdict,
    profileSkills
  });

  return {
    score,
    method: 'rules',
    confidence,
    why,
    matchedSkills: [...new Set([...matchedRequired, ...matchedPreferred, ...otherMatched])],
    matchedRequired,
    matchedPreferred,
    missingRequired,
    missingPreferred,
    otherMatched,
    requiredSkills: required,
    preferredSkills: preferred,
    mentionedSkills: mentioned,
    experienceAssessment,
    locationAssessment,
    locationEligibility: eligibility.status,
    educationAssessment: signals.degreeRequired
      ? educationMet
        ? 'The posting mentions a degree requirement; your profile lists education.'
        : 'The posting mentions a degree requirement; no education was found in your profile.'
      : 'No explicit degree requirement detected.',
    experienceGap: expGap,
    seniorityGap: sGap,
    verdict,
    recommendation,
    worthApplying: recommendation === 'apply',
    breakdown: {
      required: { score: Math.round((required.length ? requiredCoverage : overallCoverage) * 38), max: 38, matched: matchedRequired.length, total: required.length || mentioned.length },
      preferred: { score: Math.round((preferred.length ? preferredCoverage : overallCoverage) * 10), max: 10, matched: matchedPreferred.length, total: preferred.length },
      experience: { score: Math.round(experienceScore), max: 16, candidateYears: years, requiredMin: expMin, requiredMax: expMax },
      seniority: { score: Math.round(seniorityScore), max: 10, candidate: profile.experienceLevel || inferCandidateLevel(years), job: signals.seniority },
      title: { score: Math.round(titleScore), max: 10, bestMatch: bestTitle, similarity: Math.round(bestTitleScore * 100) / 100 },
      location: { score: Math.round(locationScore), max: 10, status: eligibility.status, workMode: signals.workMode, modeAllowed },
      education: { score: educationScore, max: 3 },
      projects: { score: Math.round(projectScore * 10) / 10, max: 3, matches: [...new Set(projectSkillMatches)].slice(0, 8) }
    },
    matchedProjects: [...new Set(projectSkillMatches)].slice(0, 8)
  };
}

export function applyScoreCaps(score, ctx) {
  let capped = clamp(Number(score) || 0, 0, 100);
  if (ctx.eligibility === 'restricted') capped = Math.min(capped, 55);
  if (ctx.requiredCount > 0) {
    if (ctx.missingRequiredCount >= 2) capped = Math.min(capped, 64);
    else if (ctx.missingRequiredCount === 1) capped = Math.min(capped, 82);
    if (ctx.requiredCoverage < 0.5) capped = Math.min(capped, 60);
    else if (ctx.requiredCoverage < 0.7) capped = Math.min(capped, 76);
  } else {
    capped = Math.min(capped, 88);
  }
  if (ctx.expGap != null) {
    if (ctx.expGap >= 3) capped = Math.min(capped, 65);
    else if (ctx.expGap >= 2) capped = Math.min(capped, 75);
  }
  if (ctx.seniorityGap != null && ctx.seniorityGap >= 2) capped = Math.min(capped, 68);
  return Math.round(capped);
}

export function inferCandidateLevel(years) {
  if (years == null) return 'unknown';
  if (years >= 10) return 'principal';
  if (years >= 7) return 'lead';
  if (years >= 5) return 'senior';
  if (years >= 2) return 'mid';
  if (years >= 1) return 'junior';
  return 'entry';
}

function describeExperience(years, exp, gap, seniority) {
  const have = years == null ? 'unknown' : `~${years} year${years === 1 ? '' : 's'}`;
  if (exp.min == null) {
    return `No explicit years requirement was found; the posting is ${seniority}-level. Your experience: ${have}.`;
  }
  const range = exp.max ? `${exp.min}–${exp.max}` : `${exp.min}+`;
  if (years == null) return `The posting asks for ${range} years; your profile does not state total experience.`;
  if (gap <= 0) return `The posting asks for ${range} years; you have ${have}, which meets the requirement.`;
  if (gap <= 1) return `The posting asks for ${range} years; you have ${have} — a slight stretch but close enough to consider.`;
  return `The posting asks for ${range} years; you have ${have} — a ${Math.round(gap)}-year gap that matters for this role.`;
}

function buildVerdict(score, missingRequired, eligibility, expGap, seniorityGap) {
  if (eligibility === 'restricted') return 'Likely ineligible — the location or work authorization does not match your profile.';
  if (missingRequired.length >= 3) return 'Not recommended — several explicitly required skills are missing.';
  if (missingRequired.length === 2) return 'Stretch — two required skills are missing; only apply if you can show equivalent experience.';
  if (missingRequired.length === 1) return 'Good match with one important gap — worth applying only if you can address it.';
  if (expGap != null && expGap >= 3) return 'Not recommended — the experience gap is too large for this posting.';
  if (seniorityGap != null && seniorityGap >= 2) return 'Stretch — this role is pitched well above your current seniority.';
  if (score >= 80) return 'Strong match — worth applying.';
  if (score >= 70) return 'Good match — apply if the role and location fit your goals.';
  if (score >= 55) return 'Moderate match — apply selectively and tailor your resume to the gaps.';
  return 'Not recommended — important requirements are missing.';
}

function buildWhy({ score, matchedRequired, matchedPreferred, missingRequired, missingPreferred, overallCoverage, required, experienceAssessment, locationAssessment, verdict, profileSkills }) {
  const parts = [];
  if (matchedRequired.length) {
    parts.push(`Your profile covers ${matchedRequired.slice(0, 5).join(', ')}${matchedRequired.length > 5 ? ` and ${matchedRequired.length - 5} more` : ''} from the required skills.`);
  } else if (required.length) {
    parts.push(`None of the ${required.length} explicitly required skills were found in your profile.`);
  } else if (overallCoverage > 0.45) {
    parts.push(`The posting does not separate required from preferred skills; your profile overlaps with roughly ${Math.round(overallCoverage * 100)}% of the skills mentioned.`);
  } else {
    parts.push('The posting does not list a clear skill set that matches your profile.');
  }
  if (missingRequired.length) parts.push(`Missing required: ${missingRequired.slice(0, 6).join(', ')}.`);
  if (matchedPreferred.length) parts.push(`Also matches preferred: ${matchedPreferred.slice(0, 4).join(', ')}.`);
  if (missingPreferred.length) parts.push(`Preferred but not evidenced: ${missingPreferred.slice(0, 4).join(', ')}.`);
  parts.push(experienceAssessment);
  parts.push(locationAssessment);
  parts.push(verdict);
  if (score >= 80 && !missingRequired.length) parts.push('The score reflects strong overlap, not a guarantee — review the original posting before applying.');
  return parts.join(' ');
}

/**
 * Convert an AI response into the same shape as the rules matcher, while
 * enforcing deterministic caps so the model cannot inflate a score when
 * required skills or experience are missing.
 */
export function normalizeAiMatch(ai, profile, preferences, job, signals) {
  const base = buildRulesMatch(profile, preferences, job, signals);
  const score = clamp(Number(ai?.score) || 0, 0, 100);
  const strings = (value) => (Array.isArray(value) ? [...new Set(value.map((v) => String(v).trim()).filter(Boolean))] : []);
  const aiMatched = strings(ai?.matchedRequired).slice(0, 30);
  const aiMissing = strings(ai?.missingRequired).slice(0, 30);
  const aiRequired = strings(ai?.requiredSkills).slice(0, 30);
  const requiredSkills = [...new Set([...base.requiredSkills, ...aiRequired, ...aiMatched, ...aiMissing])];

  // The deterministic pass and the AI pass are merged conservatively: a skill
  // either pass considers missing stays missing, so the model cannot inflate a
  // score by ignoring a detected gap.
  const missingByKey = new Map();
  for (const name of [...base.missingRequired, ...aiMissing]) missingByKey.set(name.toLowerCase(), name);
  const matchedRequired = [...new Set([...base.matchedRequired, ...aiMatched])]
    .filter((name) => !missingByKey.has(name.toLowerCase()));
  const missingRequired = [...missingByKey.values()];
  const requiredCount = Math.max(requiredSkills.length, matchedRequired.length + missingRequired.length);
  const requiredCoverage = requiredCount ? matchedRequired.length / requiredCount : 0;
  const expGap = base.experienceGap;
  const sGap = base.seniorityGap;
  const capped = applyScoreCaps(score, {
    requiredCount,
    missingRequiredCount: missingRequired.length,
    requiredCoverage,
    eligibility: base.locationEligibility,
    expGap,
    seniorityGap: sGap,
    hasExplicitRequirements: requiredCount > 0
  });

  const verdict = capped < score
    ? `${ai?.verdict || base.verdict} (score capped from ${score} because required gaps or eligibility limits apply.)`
    : (ai?.verdict || base.verdict);
  const recommendation = base.locationEligibility === 'restricted' || missingRequired.length >= 2 || capped < 55
    ? 'skip'
    : (missingRequired.length === 1 || capped < 72) ? 'consider' : 'apply';

  return {
    ...base,
    score: capped,
    method: 'ai',
    aiRawScore: score,
    confidence: ai?.confidence === 'high' || ai?.confidence === 'medium' || ai?.confidence === 'low' ? ai.confidence : base.confidence,
    why: ai?.why ? oneLine(ai.why, 1400) : base.why,
    matchedSkills: strings(ai?.matchedSkills).filter((name) => !missingByKey.has(name.toLowerCase())).slice(0, 40),
    matchedRequired,
    missingRequired,
    matchedPreferred: Array.isArray(ai?.matchedPreferred) ? ai.matchedPreferred.map(String).slice(0, 20) : base.matchedPreferred,
    missingPreferred: Array.isArray(ai?.missingPreferred) ? ai.missingPreferred.map(String).slice(0, 20) : base.missingPreferred,
    requiredSkills,
    preferredSkills: base.preferredSkills.length ? base.preferredSkills : strings(ai?.preferredSkills).slice(0, 24),
    experienceAssessment: ai?.experienceAssessment ? oneLine(ai.experienceAssessment, 500) : base.experienceAssessment,
    locationAssessment: ai?.locationAssessment ? oneLine(ai.locationAssessment, 400) : base.locationAssessment,
    educationAssessment: ai?.educationAssessment ? oneLine(ai.educationAssessment, 400) : base.educationAssessment,
    verdict: oneLine(verdict, 400),
    recommendation,
    worthApplying: recommendation === 'apply',
    aiNotes: ai?.notes ? oneLine(ai.notes, 600) : ''
  };
}

export function scoreFromSignals(profile, preferences, job, signals) {
  return buildRulesMatch(profile, preferences, job, signals);
}

export function candidateCountry(profile, preferences) {
  return detectCountry(profile?.location) || detectCountry((preferences?.countries || []).join(' ')) || 'India';
}

export { extractExperience };
