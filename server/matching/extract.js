import { detectSkills } from './skills.js';
import { detectWorkMode, normalizeLocation } from './location.js';
import { oneLine, normalizeWhitespace } from '../lib/util.js';

const PREFERRED_RE = /\b(preferred|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|a plus|desired|advantage|optional|ideally)\b/i;
const REQUIRED_RE = /\b(required|must[- ]have|minimum|at least|proficien\w*|strong (?:experience|knowledge|background)|hands[- ]on|solid (?:experience|knowledge)|expertise|experience (?:in|with)|knowledge of|familiarity with|working knowledge|ability to)\b/i;
const DEGREE_RE = /\b(bachelor'?s?|master'?s?|b\.?tech|b\.?e\.?|b\.?sc|m\.?sc|mba|ph\.?d|doctorate|degree in|graduation)\b/i;

const HEADING_MAP = [
  [/^(what you.?ll need|what we.?re looking for|requirements?|qualifications?|must[- ]haves?|who you are|about you|skills? (?:and|&) experience|experience required|minimum qualifications?)\b/i, 'requirements'],
  [/^(preferred|nice[- ]to[- ]have|bonus|good[- ]to[- ]have|desired|plus points?)\b/i, 'preferred'],
  [/^(responsibilities|what you.?ll do|the role|role|duties|day[- ]to[- ]day|key responsibilities)\b/i, 'responsibilities'],
  [/^(education|academic)\b/i, 'education'],
  [/^(benefits?|perks|compensation|salary|why join|what we offer)\b/i, 'benefits'],
  [/^(about (?:us|the company|the team)|company|who we are|our mission)\b/i, 'company']
];

export function splitSections(description) {
  const text = normalizeWhitespace(description || '');
  if (!text) return [{ heading: '', kind: 'general', body: '' }];
  const lines = text.split('\n');
  const blocks = [];
  let current = { heading: '', kind: 'general', body: [] };

  const isHeading = (line) => {
    // Bullet and numbered list items are content, not section headings. Without
    // this guard a line such as "- Must have AWS" would be treated as a heading
    // and its skills would disappear from the requirements section.
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) return false;
    const clean = line.replace(/^[#*\-\s]+/, '').replace(/[:•]+$/, '').trim();
    if (!clean || clean.length > 90) return false;
    if (HEADING_MAP.some(([re]) => re.test(clean))) return true;
    if (/^[A-Z][A-Z\s&/,-]{3,60}$/.test(clean) && clean.split(/\s+/).length <= 8) return true;
    return /^(requirements?|qualifications?|responsibilities|preferred|education|benefits|about)\b/i.test(clean) && clean.length < 70;
  };

  for (const line of lines) {
    if (isHeading(line)) {
      if (current.body.length || current.heading) blocks.push({ ...current, body: current.body.join('\n') });
      const heading = line.replace(/^[#*\-\s]+/, '').replace(/[:•]+$/, '').trim();
      const kind = HEADING_MAP.find(([re]) => re.test(heading))?.[1] || 'general';
      current = { heading, kind, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length || current.heading) blocks.push({ ...current, body: current.body.join('\n') });

  const nonEmpty = blocks.filter((b) => b.body.trim());
  return nonEmpty.length ? nonEmpty : [{ heading: '', kind: 'general', body: text }];
}

/**
 * Extract required/preferred/mentioned skills, experience requirements and
 * other structured signals from a job description. This is deterministic and
 * deliberately conservative: a skill is only "required" when the posting puts
 * it in a requirements-like section or uses must-have language.
 */
export function extractJobSignals(job) {
  const description = normalizeWhitespace(job.description || '');
  const title = job.title || '';
  const sections = splitSections(description);
  const required = new Map();
  const preferred = new Map();
  const mentioned = new Map();

  for (const section of sections) {
    const skills = detectSkills(section.body);
    for (const skill of skills) {
      const context = skill.context || section.body.slice(0, 400);
      let bucket = mentioned;
      if (section.kind === 'preferred') bucket = preferred;
      else if (section.kind === 'requirements') bucket = PREFERRED_RE.test(context) && !REQUIRED_RE.test(context) ? preferred : required;
      else if (section.kind === 'responsibilities') bucket = REQUIRED_RE.test(context) ? required : mentioned;
      else if (section.kind === 'benefits' || section.kind === 'company') bucket = mentioned;
      else if (REQUIRED_RE.test(context)) bucket = required;
      else if (PREFERRED_RE.test(context)) bucket = preferred;

      if (!bucket.has(skill.name)) {
        bucket.set(skill.name, { name: skill.name, count: skill.count, context: skill.context, section: section.heading });
      }
    }
  }

  // A skill can appear in both a must-have and a nice-to-have list. Required wins.
  for (const name of required.keys()) preferred.delete(name);
  for (const name of preferred.keys()) mentioned.delete(name);
  for (const name of required.keys()) mentioned.delete(name);

  const experience = extractExperience(description, title);
  const seniority = inferSeniority(title, experience.min);
  const workMode = detectWorkMode({
    title,
    location: job.location || '',
    description,
    hint: job.workModeHint || job.workplaceType || ''
  });
  const salary = parseSalary(job.salaryText || '', description);
  const degreeRequired = sections.some((s) => (s.kind === 'requirements' || s.kind === 'education') && DEGREE_RE.test(s.body));
  const degreeText = degreeRequired
    ? oneLine(sections.find((s) => (s.kind === 'requirements' || s.kind === 'education') && DEGREE_RE.test(s.body))?.body || '', 180)
    : '';

  return {
    requiredSkills: [...required.values()].slice(0, 30),
    preferredSkills: [...preferred.values()].slice(0, 24),
    mentionedSkills: [...mentioned.values()].slice(0, 40),
    experience,
    seniority,
    workMode,
    salary,
    degreeRequired,
    degreeText,
    summary: summarize(description, job.summary),
    sections: sections.map((s) => ({ heading: s.heading, kind: s.kind, length: s.body.length }))
  };
}

export function extractExperience(text, title = '') {
  const source = normalizeWhitespace(text || '');
  const candidates = [];

  const rangeRe = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
  const plusRe = /(\d{1,2})\s*\+\s*(?:years?|yrs?)/gi;
  const minRe = /(?:minimum|min\.?|at least|over|more than)\s*(\d{1,2})\s*(?:years?|yrs?)/gi;
  const yearsRe = /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|hands[- ]on\s+)?experience/gi;

  let m;
  while ((m = rangeRe.exec(source)) !== null) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (min <= 30 && max <= 40 && max >= min) {
      candidates.push({ min, max, text: m[0], start: m.index, end: m.index + m[0].length, range: true });
    }
  }
  while ((m = plusRe.exec(source)) !== null) {
    const min = Number(m[1]);
    if (min <= 30) candidates.push({ min, max: null, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  while ((m = minRe.exec(source)) !== null) {
    const min = Number(m[1]);
    if (min <= 30) candidates.push({ min, max: null, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  while ((m = yearsRe.exec(source)) !== null) {
    const min = Number(m[1]);
    if (min <= 30) candidates.push({ min, max: null, text: m[0], start: m.index, end: m.index + m[0].length });
  }

  if (/\b(fresher|fresh graduate|entry[- ]level|no experience required|0\s*[-–]\s*[01]\s*years?)\b/i.test(source)) {
    candidates.push({ min: 0, max: 1, text: 'fresher / entry level', start: 0, end: 0 });
  }

  // A range such as "3-6 years" also matches the single-value pattern as
  // "6 years"; keep the range and discard the overlapping single value.
  const ranges = candidates.filter((c) => c.range);
  const distinct = candidates.filter((c) => !ranges.some((r) => c !== r && c.start < r.end && c.end > r.start));

  if (distinct.length) {
    const min = Math.max(...distinct.map((c) => c.min));
    const maxes = distinct.map((c) => c.max).filter((v) => Number.isFinite(v));
    return {
      min,
      max: maxes.length ? Math.max(...maxes) : null,
      text: distinct.sort((a, b) => b.min - a.min)[0].text,
      source: 'explicit'
    };
  }

  const inferred = inferExperienceFromTitle(title);
  if (inferred) return { ...inferred, source: 'title' };
  return { min: null, max: null, text: '', source: 'unknown' };
}

export function inferExperienceFromTitle(title = '') {
  const t = String(title).toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return { min: 0, max: 1, text: 'internship' };
  if (/\b(entry[- ]level|graduate|junior|jr\.?|associate)\b/.test(t)) return { min: 0, max: 2, text: 'entry / junior title' };
  if (/\b(principal|distinguished|architect)\b/.test(t)) return { min: 10, max: null, text: 'principal-level title' };
  if (/\b(staff)\b/.test(t)) return { min: 8, max: null, text: 'staff-level title' };
  if (/\b(lead|team lead|tech lead)\b/.test(t)) return { min: 6, max: null, text: 'lead title' };
  if (/\b(senior|sr\.?)\b/.test(t)) return { min: 5, max: null, text: 'senior title' };
  if (/\b(manager|head of|director|vp|vice president|chief)\b/.test(t)) return { min: 7, max: null, text: 'management title' };
  if (/\b(mid[- ]level|specialist|consultant)\b/.test(t)) return { min: 2, max: 5, text: 'mid-level title' };
  return null;
}

const SENIORITY_ORDER = { intern: 0, entry: 1, junior: 1, mid: 2, senior: 3, lead: 4, staff: 4, principal: 5, manager: 4, director: 5, executive: 6, unknown: 2 };

export function inferSeniority(title = '', expMin = null) {
  const t = String(title).toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return 'intern';
  if (/\b(entry[- ]level|graduate|junior|jr\.?)\b/.test(t)) return 'entry';
  if (/\b(principal|distinguished|architect)\b/.test(t)) return 'principal';
  if (/\b(staff)\b/.test(t)) return 'staff';
  if (/\b(lead|team lead|tech lead)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?)\b/.test(t)) return 'senior';
  if (/\b(director|vp|vice president|chief|head of)\b/.test(t)) return 'executive';
  if (/\b(manager)\b/.test(t)) return 'manager';
  if (/\b(associate|mid[- ]level|specialist|consultant)\b/.test(t)) return 'mid';
  if (Number.isFinite(expMin)) {
    if (expMin >= 10) return 'principal';
    if (expMin >= 7) return 'lead';
    if (expMin >= 5) return 'senior';
    if (expMin >= 2) return 'mid';
    return 'entry';
  }
  return 'mid';
}

export function seniorityGap(candidateLevel, jobLevel) {
  const a = SENIORITY_ORDER[candidateLevel] ?? 2;
  const b = SENIORITY_ORDER[jobLevel] ?? 2;
  return b - a;
}

export function parseSalary(salaryText = '', description = '') {
  const explicit = normalizeWhitespace(salaryText || '');
  if (explicit) {
    const found = findSalary(explicit, { requireContext: false });
    if (found) return found;
  }
  const body = normalizeWhitespace(description || '').slice(0, 8000);
  return body ? findSalary(body, { requireContext: true }) : null;
}

const SALARY_UNIT = 'k|lpa|lakhs?|lacs?|crores?|cr|m|million';
const CURRENCY = '₹|rs\\.?|inr|usd|eur|gbp|\\$|€|£';

function findSalary(text, { requireContext }) {
  const rangeRe = new RegExp(
    `(?:${CURRENCY})\\s*(?<min>[\\d,.]+)\\s*(?<unitMin>${SALARY_UNIT})?\\s*(?:-|–|—|to)\\s*(?:${CURRENCY})?\\s*(?<max>[\\d,.]+)\\s*(?<unitMax>${SALARY_UNIT})?`,
    'gi'
  );
  const unitRangeRe = /(?<min>[\d,.]+)\s*(?:-|–|—|to)\s*(?<max>[\d,.]+)\s*(?<unit>lpa|lakhs?|lacs?|crores?|cr)\b/gi;
  const contextualSingleRe = new RegExp(
    `(?:${CURRENCY})\\s*(?<amount>[\\d,.]+)\\s*(?<unit>${SALARY_UNIT})?\\s*(?<period>per\\s+annum|per\\s+year|per\\s+month|per\\s+hour|\\/\\s*(?:yr|year|mo|month|hr|hour)|annually|monthly|hourly|ctc|salary|compensation|package)`,
    'gi'
  );
  const labelledRe = new RegExp(
    `(?:salary|compensation|ctc|package|pay(?:\\s+range)?)\\s*(?:of|:|-|–)?\\s*(?:${CURRENCY})?\\s*(?<amount>[\\d,.]+)\\s*(?<unit>${SALARY_UNIT})?`,
    'gi'
  );
  const bareRe = new RegExp(`(?:${CURRENCY})\\s*(?<amount>[\\d,.]+)\\s*(?<unit>${SALARY_UNIT})?`, 'gi');

  let match;
  while ((match = rangeRe.exec(text)) !== null) {
    if (isFundingAmount(text, match.index)) continue;
    const min = toAmount(match.groups.min, match.groups.unitMin || match.groups.unitMax);
    const max = toAmount(match.groups.max, match.groups.unitMax || match.groups.unitMin);
    if (!Number.isFinite(min) || min <= 0) continue;
    return salaryResult(text, match, min, max);
  }
  while ((match = unitRangeRe.exec(text)) !== null) {
    if (isFundingAmount(text, match.index)) continue;
    const min = toAmount(match.groups.min, match.groups.unit);
    const max = toAmount(match.groups.max, match.groups.unit);
    if (!Number.isFinite(min) || min <= 0) continue;
    return salaryResult(text, match, min, max);
  }
  while ((match = contextualSingleRe.exec(text)) !== null) {
    if (isFundingAmount(text, match.index)) continue;
    const amount = toAmount(match.groups.amount, match.groups.unit);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return salaryResult(text, match, amount, amount);
  }
  while ((match = labelledRe.exec(text)) !== null) {
    if (isFundingAmount(text, match.index)) continue;
    const amount = toAmount(match.groups.amount, match.groups.unit);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return salaryResult(text, match, amount, amount);
  }
  if (requireContext) {
    while ((match = bareRe.exec(text)) !== null) {
      if (isFundingAmount(text, match.index)) continue;
      if (!hasSalaryContext(text, match.index)) continue;
      const unit = String(match.groups.unit || '').toLowerCase();
      if (unit === 'm' || unit === 'million') continue;
      const amount = toAmount(match.groups.amount, match.groups.unit);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      return salaryResult(text, match, amount, amount);
    }
  }
  return null;
}

function salaryResult(text, match, min, max) {
  const window = text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
  return {
    min,
    max: Number.isFinite(max) ? Math.max(max, min) : min,
    currency: detectCurrency(`${match[0]} ${window}`),
    period: detectSalaryPeriod(`${match[0]} ${window}`),
    text: oneLine(match[0], 90)
  };
}

function hasSalaryContext(text, index) {
  const window = text.slice(Math.max(0, index - 140), index + 160).toLowerCase();
  return /salary|compensation|ctc|package|pay range|per annum|per year|annually|lpa|lakh|crore|remuneration/.test(window);
}

function isFundingAmount(text, index) {
  const window = text.slice(Math.max(0, index - 120), index + 180).toLowerCase();
  const funding = /raised|funding|series [a-e]\b|valuation|invested|investment|backed by|revenue|arr\b|market size|grant|budget|cost|price/.test(window);
  return funding && !hasSalaryContext(text, index);
}

function detectSalaryPeriod(text) {
  const value = text.toLowerCase();
  if (/hour|hourly|\/hr/.test(value)) return 'hour';
  if (/month|monthly|\/mo/.test(value)) return 'month';
  return 'year';
}

function toAmount(raw, unit = '') {
  let value = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const u = String(unit).toLowerCase();
  if (u === 'k') value *= 1_000;
  else if (u === 'm' || u === 'million') value *= 1_000_000;
  else if (u === 'lpa' || u.startsWith('lakh') || u.startsWith('lac')) value *= 100_000;
  else if (u === 'cr' || u.startsWith('crore')) value *= 10_000_000;
  return Math.round(value);
}

function detectCurrency(text) {
  const t = text.toLowerCase();
  if (t.includes('₹')) return 'INR';
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('$')) return 'USD';
  if (/\b(?:inr|rs)\b|rupee|lpa|lakh|crore/.test(t)) return 'INR';
  if (/\beur\b/.test(t)) return 'EUR';
  if (/\bgbp\b/.test(t)) return 'GBP';
  if (/\busd\b/.test(t)) return 'USD';
  return 'USD';
}

export function summarize(description, provided) {
  if (provided) return oneLine(provided, 320);
  const text = normalizeWhitespace(description || '');
  if (!text) return '';
  const sections = splitSections(text);
  const general = sections.find((s) => s.kind === 'general' && s.body.length > 80) || sections[0];
  const body = (general?.body || text)
    .replace(/^(about (?:us|the company|the team)[^\n]*\n)/i, '')
    .replace(/^(who we are[^\n]*\n)/i, '');
  const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40);
  let summary = '';
  for (const sentence of sentences) {
    if (summary.length + sentence.length > 300) break;
    summary += `${summary ? ' ' : ''}${sentence}`;
  }
  if (!summary) summary = body;
  return oneLine(summary, 320);
}

export function normalizeJobLocation(location) {
  return normalizeLocation(location);
}
