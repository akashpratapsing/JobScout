import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJobSignals, extractExperience, inferExperienceFromTitle, inferSeniority, parseSalary, seniorityGap, splitSections } from '../server/matching/extract.js';
import { buildRulesMatch, applyScoreCaps, normalizeAiMatch, inferCandidateLevel, candidateYears, collectProfileSkills } from '../server/matching/score.js';
import { makeJob, makeProfile, makePreferences } from './helpers.js';

const DESCRIPTION = `About us
Acme builds developer tools for teams around the world.

Requirements
- 5+ years of experience in backend development
- Strong experience with Python, AWS, Docker and PostgreSQL
- Bachelor's degree in Computer Science or equivalent

Nice to have
- GraphQL
- Kubernetes

Benefits
- Health insurance
- Salary: ₹25–35 LPA`;

function jobWith(overrides = {}) {
  return makeJob({
    title: 'Senior Backend Engineer',
    location: 'Bengaluru, India',
    description: DESCRIPTION,
    ...overrides
  });
}

function profileWithoutAws() {
  const base = makeProfile();
  return makeProfile({
    skills: base.skills.filter((skill) => skill !== 'AWS'),
    certifications: base.certifications.filter((cert) => !/AWS/i.test(cert)),
    experience: base.experience.map((entry) => ({
      ...entry,
      description: entry.description.replace(/\bAWS\b,?\s*/g, ''),
      technologies: entry.technologies.filter((tech) => tech !== 'AWS')
    })),
    projects: base.projects.map((project) => ({
      ...project,
      technologies: project.technologies.filter((tech) => tech !== 'AWS')
    }))
  });
}

test('splits sections without treating bullet items as headings', () => {
  const sections = splitSections(DESCRIPTION);
  const kinds = sections.map((section) => section.kind);
  assert.ok(kinds.includes('requirements'));
  assert.ok(kinds.includes('preferred'));
  const requirements = sections.find((section) => section.kind === 'requirements');
  assert.match(requirements.body, /Python, AWS, Docker and PostgreSQL/);
});

test('bullet must-have language still marks skills as required', () => {
  const signals = extractJobSignals({
    title: 'Backend Engineer',
    description: 'Responsibilities\nBuild services.\n\n- Must have AWS and Docker\n- Python experience required',
    location: 'Bengaluru, India'
  });
  const required = signals.requiredSkills.map((skill) => skill.name);
  assert.ok(required.includes('AWS'));
  assert.ok(required.includes('Docker'));
  assert.ok(required.includes('Python'));
});

test('extracts required, preferred and mentioned skills separately', () => {
  const signals = extractJobSignals(jobWith());
  const required = signals.requiredSkills.map((skill) => skill.name);
  const preferred = signals.preferredSkills.map((skill) => skill.name);

  assert.ok(required.includes('Python'));
  assert.ok(required.includes('AWS'));
  assert.ok(required.includes('Docker'));
  assert.ok(required.includes('PostgreSQL'));
  assert.ok(preferred.includes('GraphQL'));
  assert.ok(preferred.includes('Kubernetes'));
  assert.ok(!required.includes('GraphQL'));
  assert.equal(signals.experience.min, 5);
  assert.equal(signals.experience.source, 'explicit');
  assert.equal(signals.seniority, 'senior');
  assert.equal(signals.degreeRequired, true);
  assert.equal(signals.workMode, 'onsite');
  assert.equal(signals.salary.currency, 'INR');
  assert.equal(signals.salary.min, 2500000);
  assert.equal(signals.salary.max, 3500000);
});

test('required wins when a skill appears in both lists', () => {
  const signals = extractJobSignals({
    title: 'Backend Engineer',
    location: 'Remote',
    description: 'Requirements\nPython and AWS are required.\n\nNice to have\nPython and Kubernetes.'
  });
  assert.ok(signals.requiredSkills.some((skill) => skill.name === 'Python'));
  assert.ok(!signals.preferredSkills.some((skill) => skill.name === 'Python'));
});

test('parses experience ranges, plus ranges and title fallbacks', () => {
  assert.deepEqual(extractExperience('You need 3-6 years of experience.'), { min: 3, max: 6, text: '3-6 years', source: 'explicit' });
  assert.deepEqual(extractExperience('Minimum 4 years experience required.'), { min: 4, max: null, text: 'Minimum 4 years', source: 'explicit' });
  assert.equal(extractExperience('Fresher role, no experience required.').min, 0);
  assert.deepEqual(extractExperience('', 'Senior Engineer'), { min: 5, max: null, text: 'senior title', source: 'title' });
  assert.equal(extractExperience('', 'Backend Engineer').source, 'unknown');
  assert.equal(inferExperienceFromTitle('Staff Engineer').min, 8);
  assert.equal(inferSeniority('Principal Engineer'), 'principal');
  assert.equal(seniorityGap('mid', 'senior'), 1);
});

test('parses common salary formats conservatively', () => {
  const lpa = parseSalary('₹25–35 LPA');
  assert.equal(lpa.currency, 'INR');
  assert.equal(lpa.min, 2500000);
  assert.equal(lpa.max, 3500000);
  assert.equal(lpa.period, 'year');

  const usd = parseSalary('$120,000 - $150,000 per year');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.min, 120000);
  assert.equal(usd.max, 150000);

  const monthly = parseSalary('EUR 5,000 per month');
  assert.equal(monthly.currency, 'EUR');
  assert.equal(monthly.min, 5000);
  assert.equal(monthly.period, 'month');

  assert.equal(parseSalary('Competitive salary, disclosed later'), null);
  assert.equal(parseSalary('We raised $20M in Series B funding'), null);
});

test('strong profile scores highly and recommends applying', () => {
  const job = jobWith();
  const signals = extractJobSignals(job);
  const match = buildRulesMatch(makeProfile(), makePreferences({ countries: ['India'] }), job, signals);

  assert.ok(match.score >= 85, `expected a high score, got ${match.score}`);
  assert.equal(match.method, 'rules');
  assert.deepEqual(match.missingRequired, []);
  assert.ok(match.matchedRequired.includes('Python'));
  assert.ok(match.matchedRequired.includes('AWS'));
  assert.equal(match.locationEligibility, 'eligible');
  assert.equal(match.recommendation, 'apply');
  assert.equal(match.worthApplying, true);
  assert.match(match.why, /required skills/i);
  assert.ok(match.breakdown.required.score > 0);
});

test('missing required skills cap the score and block an apply recommendation', () => {
  const job = jobWith();
  const signals = extractJobSignals(job);

  const oneMissing = buildRulesMatch(
    profileWithoutAws(),
    makePreferences({ countries: ['India'] }),
    job,
    signals
  );
  assert.deepEqual(oneMissing.missingRequired, ['AWS']);
  assert.ok(oneMissing.score <= 82);
  assert.notEqual(oneMissing.recommendation, 'apply');

  const none = buildRulesMatch(
    makeProfile({ skills: [], keywords: [], experience: [], projects: [] }),
    makePreferences({ countries: ['India'] }),
    job,
    signals
  );
  assert.ok(none.missingRequired.length >= 2);
  assert.ok(none.score <= 64);
  assert.equal(none.recommendation, 'skip');
});

test('location restrictions and experience gaps cap the score', () => {
  const job = jobWith({ location: 'Berlin, Germany', workMode: 'onsite' });
  const signals = extractJobSignals(job);
  const restricted = buildRulesMatch(makeProfile(), makePreferences({ countries: ['India'], workModes: ['onsite'] }), job, signals);
  assert.equal(restricted.locationEligibility, 'restricted');
  assert.ok(restricted.score <= 55);
  assert.equal(restricted.recommendation, 'skip');

  const junior = buildRulesMatch(makeProfile({ experienceYears: 2, experienceLevel: 'mid' }), makePreferences({ countries: ['India'] }), jobWith(), signals);
  assert.ok(junior.experienceGap >= 3);
  assert.ok(junior.score <= 65);
});

test('a posting with no explicit requirements is capped below a perfect score', () => {
  const job = makeJob({ title: 'Backend Engineer', description: 'We build things. Join our team.', location: 'Bengaluru, India' });
  const signals = extractJobSignals(job);
  const match = buildRulesMatch(makeProfile(), makePreferences({ countries: ['India'] }), job, signals);
  assert.equal(match.requiredSkills.length, 0);
  assert.ok(match.score <= 88);
  assert.match(match.why, /does not separate|does not list/i);
});

test('applyScoreCaps enforces the guardrails directly', () => {
  assert.equal(applyScoreCaps(100, { requiredCount: 4, missingRequiredCount: 2, requiredCoverage: 0.5, eligibility: 'eligible' }), 64);
  assert.equal(applyScoreCaps(100, { requiredCount: 4, missingRequiredCount: 1, requiredCoverage: 0.75, eligibility: 'eligible' }), 82);
  assert.equal(applyScoreCaps(100, { requiredCount: 4, missingRequiredCount: 0, requiredCoverage: 0.6, eligibility: 'eligible' }), 76);
  assert.equal(applyScoreCaps(100, { requiredCount: 4, missingRequiredCount: 0, requiredCoverage: 1, eligibility: 'restricted' }), 55);
  assert.equal(applyScoreCaps(100, { requiredCount: 4, missingRequiredCount: 0, requiredCoverage: 1, eligibility: 'eligible', expGap: 3 }), 65);
  assert.equal(applyScoreCaps(100, { requiredCount: 0, missingRequiredCount: 0, requiredCoverage: 0, eligibility: 'eligible' }), 88);
});

test('AI matches cannot inflate a score past deterministic caps', () => {
  const job = jobWith();
  const signals = extractJobSignals(job);
  const profile = makeProfile();
  const preferences = makePreferences({ countries: ['India'] });

  const inflated = normalizeAiMatch({
    score: 100,
    matchedRequired: ['Python', 'AWS', 'Docker', 'PostgreSQL'],
    missingRequired: ['AWS', 'Docker'],
    requiredSkills: ['Python', 'AWS', 'Docker', 'PostgreSQL'],
    matchedSkills: ['Python', 'AWS', 'Docker', 'PostgreSQL'],
    verdict: 'Perfect fit',
    why: 'Everything matches.'
  }, profile, preferences, job, signals);

  assert.equal(inflated.method, 'ai');
  assert.equal(inflated.aiRawScore, 100);
  assert.ok(inflated.score <= 64, `expected cap, got ${inflated.score}`);
  assert.deepEqual(inflated.missingRequired.sort(), ['AWS', 'Docker']);
  assert.ok(!inflated.matchedRequired.includes('AWS'));
  assert.equal(inflated.recommendation, 'skip');
  assert.match(inflated.verdict, /capped/i);
});

test('AI cannot hide a gap detected by the deterministic pass', () => {
  const job = jobWith();
  const signals = extractJobSignals(job);
  const profile = profileWithoutAws();

  const result = normalizeAiMatch({
    score: 92,
    matchedRequired: ['Python', 'AWS', 'Docker', 'PostgreSQL'],
    missingRequired: [],
    requiredSkills: ['Python', 'AWS', 'Docker', 'PostgreSQL'],
    verdict: 'Strong fit'
  }, profile, makePreferences({ countries: ['India'] }), job, signals);

  assert.ok(result.missingRequired.includes('AWS'));
  assert.ok(result.score <= 82);
  assert.notEqual(result.recommendation, 'apply');
});

test('candidate helpers read years, level and skills from the profile', () => {
  assert.equal(inferCandidateLevel(0), 'entry');
  assert.equal(inferCandidateLevel(2), 'mid');
  assert.equal(inferCandidateLevel(5), 'senior');
  assert.equal(inferCandidateLevel(10), 'principal');
  assert.equal(candidateYears(makeProfile({ experienceYears: 7 })), 7);
  const skills = collectProfileSkills(makeProfile());
  assert.ok(skills.includes('Python'));
  assert.ok(skills.includes('AWS'));
  assert.ok(skills.includes('Kubernetes'));
});
