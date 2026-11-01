import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from '../server/lib/store.js';
import { decryptString } from '../server/lib/crypto.js';
import {
  sanitizeBoards,
  sanitizePreferences,
  sanitizeSettings,
  publicPreferences,
  publicManualLinks,
  filterJobs
} from '../server/lib/validation.js';
import { makeJob, makePreferences } from './helpers.js';

const secret = crypto.randomBytes(32);

function clone(value) {
  return structuredClone(value);
}

test('sanitizePreferences trims lists, filters unknown sources and keeps keys encrypted', () => {
  const current = clone(DEFAULT_PREFERENCES);
  const { preferences, credentialPatch } = sanitizePreferences({
    titles: [' Backend Engineer ', 'backend engineer'],
    enabledSources: ['greenhouse', 'linkedin', 'custom'],
    workModes: ['remote', 'bogus'],
    experienceLevels: ['senior', 'wizard'],
    minSalary: '1500000',
    maxResults: 9999,
    maxAgeDays: 0,
    dailyEnabled: true,
    dailyTime: '09:30',
    dailyTimezone: 'Asia/Kolkata',
    boards: {
      greenhouse: ['stripe', 'bad token!'],
      custom: ['https://example.com/careers', 'ftp://example.com/careers'],
      workday: [
        { tenant: 'acme', wd: 'wd5', site: 'External', label: 'Acme' },
        { tenant: 'bad', wd: 'nope', site: 'External' }
      ]
    },
    adzuna: { appId: 'app123', country: 'IN' },
    adzunaAppKey: 'super-secret-key'
  }, current, { secret });

  assert.deepEqual(preferences.titles, ['Backend Engineer', 'backend engineer']);
  assert.deepEqual(preferences.enabledSources, ['greenhouse', 'custom']);
  assert.deepEqual(preferences.workModes, ['remote']);
  assert.deepEqual(preferences.experienceLevels, ['senior']);
  assert.equal(preferences.minSalary, 1500000);
  assert.equal(preferences.maxResults, 500);
  assert.equal(preferences.maxAgeDays, 45);
  assert.equal(preferences.dailyEnabled, true);
  assert.equal(preferences.dailyTime, '09:30');
  assert.deepEqual(preferences.boards.greenhouse, ['stripe', 'badtoken']);
  assert.deepEqual(preferences.boards.custom, ['https://example.com/careers']);
  assert.equal(preferences.boards.workday.length, 1);
  assert.equal(preferences.boards.workday[0].tenant, 'acme');
  assert.equal(preferences.adzuna.appId, 'app123');
  assert.equal(preferences.adzuna.appKey, '');
  assert.ok(credentialPatch.adzunaAppKeyEnc);
  assert.equal(decryptString(credentialPatch.adzunaAppKeyEnc, secret), 'super-secret-key');
});

test('sanitizePreferences rejects bad times, timezones, URLs and orphan Adzuna keys', () => {
  const current = clone(DEFAULT_PREFERENCES);
  assert.throws(() => sanitizePreferences({ dailyTime: '25:00' }, current), /HH:MM/);
  assert.throws(() => sanitizePreferences({ dailyTimezone: 'Not/AZone' }, current), /time zone/i);
  assert.throws(() => sanitizePreferences({ boards: { custom: ['not a url'] } }, current), /valid http/);
  assert.throws(() => sanitizePreferences({ adzunaAppKey: 'key' }, current, { secret }), /app ID/i);
});

test('sanitizeBoards ignores malformed input but validates known keys', () => {
  const current = { greenhouse: ['stripe'], custom: [] };
  assert.deepEqual(sanitizeBoards(null, current), current);
  const next = sanitizeBoards({ lever: ['acme'], custom: ['https://example.com/jobs'] }, current);
  assert.deepEqual(next.lever, ['acme']);
  assert.deepEqual(next.custom, ['https://example.com/jobs']);
});

test('sanitizeSettings enforces provider rules and encrypts keys', () => {
  const current = clone(DEFAULT_SETTINGS);

  const switched = sanitizeSettings({ ai: { provider: 'groq' } }, current, { secret });
  assert.equal(switched.ai.provider, 'groq');
  assert.equal(switched.ai.model, 'openai/gpt-oss-120b');
  assert.equal(switched.ai.apiKeyEnc, null);

  assert.throws(
    () => sanitizeSettings({ ai: { provider: 'openrouter', model: 'openai/gpt-4o' } }, current, { secret }),
    /free-only/i
  );

  const free = sanitizeSettings({
    ai: { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', apiKey: 'or-key', enabled: true }
  }, current, { secret });
  assert.equal(free.ai.model, 'meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(free.ai.enabled, true);
  assert.ok(free.ai.apiKeyEnc);
  assert.equal(decryptString(free.ai.apiKeyEnc, secret), 'or-key');

  assert.throws(() => sanitizeSettings({ ai: { enabled: true } }, current, { secret }), /API key/i);
  assert.throws(() => sanitizeSettings({ ai: { provider: 'custom', baseUrl: '' } }, current, { secret }), /base URL/i);
  assert.throws(() => sanitizeSettings({ ai: { baseUrl: 'ftp://example.com' } }, current, { secret }), /http/);
});

test('sanitizeSettings clears keys on provider changes and supports privacy flags', () => {
  const current = clone(DEFAULT_SETTINGS);
  current.ai.provider = 'gemini';
  current.ai.apiKeyEnc = 'v1:old';
  current.ai.enabled = true;

  const next = sanitizeSettings({ ai: { provider: 'groq', model: 'openai/gpt-oss-120b' } }, current, { secret });
  assert.equal(next.ai.apiKeyEnc, null);
  assert.equal(next.ai.enabled, false);

  const cleared = sanitizeSettings({ ai: { clearKey: true } }, current, { secret });
  assert.equal(cleared.ai.apiKeyEnc, null);

  const privacy = sanitizeSettings({ privacy: { sendFullResumeText: false, keepResumeText: false } }, current, { secret });
  assert.equal(privacy.privacy.sendFullResumeText, false);
  assert.equal(privacy.privacy.keepResumeText, false);
});

test('publicPreferences never exposes the Adzuna key', () => {
  const preferences = makePreferences({ adzuna: { appId: 'app', appKey: 'leak-me', country: 'in' } });
  const out = publicPreferences(preferences, { credentials: { adzunaAppKeyEnc: 'v1:encrypted' } });
  assert.equal(out.adzuna.appId, 'app');
  assert.equal(out.adzuna.appKey, undefined);
  assert.equal(out.adzuna.hasAppKey, true);
});

test('publicManualLinks provides deep links for unsupported portals', () => {
  const links = publicManualLinks(
    { suggestedTitles: ['Backend Engineer'], location: 'Bengaluru, India' },
    makePreferences({ titles: ['Backend Engineer'], locations: ['Bengaluru'], countries: ['India'] })
  );
  assert.deepEqual(links.titles, ['Backend Engineer']);
  assert.equal(links.location, 'Bengaluru');
  const ids = links.sources.map((source) => source.id);
  for (const id of ['linkedin', 'indeed', 'naukri', 'foundit', 'instahyre', 'hirist', 'cutshort', 'wellfound']) {
    assert.ok(ids.includes(id), `missing manual source ${id}`);
  }
  const naukri = links.sources.find((source) => source.id === 'naukri');
  assert.match(naukri.url, /naukri\.com\/backend-engineer-jobs-in-bengaluru/);
  assert.ok(links.sources.every((source) => source.reason));
});

function job(overrides = {}) {
  return makeJob({
    id: overrides.id,
    status: 'new',
    active: true,
    source: 'greenhouse',
    workMode: 'remote',
    country: 'India',
    postedAt: '2026-10-20T00:00:00.000Z',
    firstSeenAt: '2026-10-21T00:00:00.000Z',
    lastVerifiedAt: '2026-10-29T00:00:00.000Z',
    salary: { min: 1000000 },
    match: { score: 50, matchedSkills: ['Python'] },
    ...overrides
  });
}

test('filterJobs applies status, source, mode, country, score and text filters', () => {
  const jobs = [
    job({ id: '1', status: 'new', source: 'greenhouse', workMode: 'remote', country: 'India', postedAt: '2026-10-20T00:00:00.000Z', match: { score: 90, matchedSkills: ['Python', 'AWS'] } }),
    job({ id: '2', status: 'saved', source: 'lever', workMode: 'onsite', country: 'India', postedAt: '2026-10-25T00:00:00.000Z', match: { score: 70, matchedSkills: ['Docker'] }, salary: { min: 3000000 } }),
    job({ id: '3', status: 'applied', source: 'greenhouse', workMode: 'hybrid', country: 'India', postedAt: '2026-10-18T00:00:00.000Z', match: { score: 60, matchedSkills: [] } }),
    job({ id: '4', status: 'dismissed', source: 'greenhouse', workMode: 'remote', country: 'India', match: { score: 99, matchedSkills: [] } }),
    job({ id: '5', status: 'new', source: 'greenhouse', workMode: 'remote', country: 'India', active: false, match: { score: 80, matchedSkills: [] } }),
    job({ id: '6', status: 'new', source: 'custom', workMode: 'remote', country: 'United States', postedAt: '2026-10-28T00:00:00.000Z', match: { score: 40, matchedSkills: ['Python'] }, salary: { min: 9000000 } })
  ];

  assert.deepEqual(filterJobs(jobs).jobs.map((item) => item.id), ['1', '2', '3', '6']);
  assert.deepEqual(filterJobs(jobs, { status: 'all' }).jobs.map((item) => item.id), ['4', '1', '2', '3', '6']);
  assert.deepEqual(filterJobs(jobs, { status: 'expired' }).jobs.map((item) => item.id), ['5']);
  assert.deepEqual(filterJobs(jobs, { status: 'dismissed' }).jobs.map((item) => item.id), ['4']);
  assert.deepEqual(filterJobs(jobs, { source: 'greenhouse' }).jobs.map((item) => item.id), ['1', '3']);
  assert.deepEqual(filterJobs(jobs, { workMode: 'remote' }).jobs.map((item) => item.id), ['1', '6']);
  assert.deepEqual(filterJobs(jobs, { country: 'india' }).jobs.map((item) => item.id), ['1', '2', '3']);
  assert.deepEqual(filterJobs(jobs, { minScore: '80' }).jobs.map((item) => item.id), ['1']);
  assert.deepEqual(filterJobs(jobs, { q: 'docker' }).jobs.map((item) => item.id), ['2']);
  assert.deepEqual(filterJobs(jobs, { q: 'python' }).jobs.map((item) => item.id), ['1', '6']);
});

test('filterJobs sorts and paginates', () => {
  const jobs = [
    job({ id: '1', company: 'Zeta', postedAt: '2026-10-20T00:00:00.000Z', salary: { min: 1000000 }, match: { score: 90 } }),
    job({ id: '2', company: 'Alpha', postedAt: '2026-10-25T00:00:00.000Z', salary: { min: 3000000 }, match: { score: 70 } }),
    job({ id: '3', company: 'Beta', postedAt: '2026-10-18T00:00:00.000Z', salary: { min: 2000000 }, match: { score: 80 } })
  ];
  assert.deepEqual(filterJobs(jobs, { sort: 'score' }).jobs.map((item) => item.id), ['1', '3', '2']);
  assert.deepEqual(filterJobs(jobs, { sort: 'posted' }).jobs.map((item) => item.id), ['2', '1', '3']);
  assert.deepEqual(filterJobs(jobs, { sort: 'oldest' }).jobs.map((item) => item.id), ['3', '1', '2']);
  assert.deepEqual(filterJobs(jobs, { sort: 'salary' }).jobs.map((item) => item.id), ['2', '3', '1']);
  assert.deepEqual(filterJobs(jobs, { sort: 'company' }).jobs.map((item) => item.id), ['2', '3', '1']);

  const page = filterJobs(jobs, { sort: 'score', limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.equal(page.limit, 1);
  assert.equal(page.offset, 1);
  assert.deepEqual(page.jobs.map((item) => item.id), ['3']);
});
