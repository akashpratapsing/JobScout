#!/usr/bin/env node
/**
 * Live smoke test for JobScout's real source connectors.
 *
 * This script never uses mocked responses and never writes to your real data
 * directory. It creates a temporary store, loads the bundled sample resume,
 * runs a small search against a limited set of live sources, and prints honest
 * per-source statistics. Zero results and source warnings are reported as-is.
 *
 * Usage:
 *   npm run test:live
 *   npm run test:live -- --sources=greenhouse,lever,ashby,remoteok
 *   npm run test:live -- --titles="Backend Engineer,Data Engineer" --boards=2
 *
 * Adzuna is skipped unless ADZUNA_APP_ID and ADZUNA_APP_KEY are set. Custom
 * career pages are skipped unless LIVE_CUSTOM_URLS is set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, DEFAULT_PREFERENCES } from '../server/lib/store.js';
import { extractResumeText, heuristicProfile } from '../server/resume.js';
import { runSearch } from '../server/jobs/discovery.js';
import { CONNECTORS } from '../server/jobs/registry.js';
import { config } from '../server/lib/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));

const DEFAULT_SOURCES = [
  'greenhouse', 'lever', 'ashby', 'workday', 'workable', 'recruitee',
  'remoteok', 'remotive', 'weworkremotely', 'himalayas', 'arbeitnow', 'jobicy'
];

const sources = String(args.sources || process.env.LIVE_SOURCES || DEFAULT_SOURCES.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter((value) => CONNECTORS[value]);
if (!sources.length) {
  console.error('No valid sources selected. Known sources: ' + Object.keys(CONNECTORS).join(', '));
  process.exit(2);
}

const titles = String(args.titles || process.env.LIVE_TITLES || 'Backend Engineer,Software Engineer')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const boardsPerSource = Math.max(1, Math.min(6, Number(args.boards || process.env.LIVE_BOARDS || 2)));
const maxResults = Math.max(10, Math.min(150, Number(args.max || process.env.LIVE_MAX_RESULTS || 60)));
const maxAgeDays = Math.max(1, Math.min(365, Number(args.maxAge || process.env.LIVE_MAX_AGE_DAYS || 60)));

const logger = {
  info(message, meta) {
    console.log(`[info] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  },
  warn(message) {
    console.warn(`[warn] ${message}`);
  },
  error(message, meta) {
    console.error(`[error] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  },
  sourceError(record) {
    console.warn(`[source] ${record.source}: ${record.message}`);
  }
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobscout-live-'));
let store;
try {
  store = new Store(tempDir);
  await store.init();

  const profile = await loadSampleProfile();
  await store.update((data) => {
    data.profile = profile;
    data.preferences = livePreferences();
  });

  console.log('');
  console.log('JobScout live smoke test');
  console.log(`  sources : ${sources.join(', ')}`);
  console.log(`  titles  : ${titles.join(', ')}`);
  console.log(`  boards  : up to ${boardsPerSource} per configured source`);
  console.log(`  max age : ${maxAgeDays} days`);
  console.log(`  data    : ${tempDir} (temporary)`);
  console.log('');

  const run = await runSearch({
    store,
    logger,
    secret: null,
    reason: 'live-smoke',
    onProgress: (current) => {
      if (current.progress?.message) console.log(`  · ${current.progress.message}`);
    }
  });

  printRun(run);
  process.exitCode = run.status === 'completed' ? 0 : 1;
} catch (error) {
  console.error(`Live smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (store) {
    // Give the store's atomic write chain a chance to settle before cleanup.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function loadSampleProfile() {
  const pdf = path.join(root, 'test', 'fixtures', 'sample-resume.pdf');
  if (fs.existsSync(pdf)) {
    const text = await extractResumeText(fs.readFileSync(pdf), 'sample-resume.pdf');
    return heuristicProfile(text, 'sample-resume.pdf');
  }
  const fallback = [
    'Aarav Sharma',
    'Bengaluru, India | aarav.sharma@example.com',
    '',
    'Summary',
    'Backend engineer with 5 years of experience building Python and Node.js services.',
    '',
    'Skills',
    'Python, JavaScript, TypeScript, Node.js, PostgreSQL, Redis, AWS, Docker, Kubernetes, Terraform',
    '',
    'Experience',
    'Senior Backend Engineer | Nimbus Labs | Jan 2022 - Present',
    'Built Python services on AWS with Docker, PostgreSQL and Kubernetes.'
  ].join('\n');
  return heuristicProfile(fallback, 'live-smoke.txt');
}

function livePreferences() {
  const preferences = structuredClone(DEFAULT_PREFERENCES);
  preferences.titles = titles;
  preferences.countries = ['India', 'United States', 'United Kingdom', 'Germany', 'Singapore', 'Remote'];
  preferences.locations = [];
  preferences.workModes = ['remote', 'hybrid', 'onsite'];
  preferences.maxAgeDays = maxAgeDays;
  preferences.maxResults = maxResults;
  preferences.dailyEnabled = false;
  preferences.enabledSources = [...sources];

  // Keep the live run small and polite: two boards per ATS by default.
  preferences.boards.greenhouse = preferences.boards.greenhouse.slice(0, boardsPerSource);
  preferences.boards.lever = preferences.boards.lever.slice(0, boardsPerSource);
  preferences.boards.ashby = preferences.boards.ashby.slice(0, boardsPerSource);
  preferences.boards.workday = preferences.boards.workday.slice(0, boardsPerSource);
  preferences.boards.workable = preferences.boards.workable.slice(0, boardsPerSource);
  preferences.boards.recruitee = preferences.boards.recruitee.slice(0, boardsPerSource);
  preferences.boards.smartrecruiters = preferences.boards.smartrecruiters.slice(0, boardsPerSource);
  preferences.boards.custom = String(process.env.LIVE_CUSTOM_URLS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 2);

  const appId = process.env.ADZUNA_APP_ID || '';
  const appKey = process.env.ADZUNA_APP_KEY || '';
  if (appId && appKey) {
    preferences.adzuna = { appId, appKey, country: process.env.ADZUNA_COUNTRY || 'in' };
  } else {
    preferences.enabledSources = preferences.enabledSources.filter((source) => source !== 'adzuna');
  }
  return preferences;
}

function printRun(run) {
  const stats = run.stats || {};
  console.log('');
  console.log('Run result');
  console.log(`  status          : ${run.status}`);
  console.log(`  duration        : ${run.durationMs == null ? 'n/a' : `${(run.durationMs / 1000).toFixed(1)}s`}`);
  console.log(`  scanned         : ${stats.rawDiscovered ?? 0}`);
  console.log(`  normalized      : ${stats.normalized ?? 0}`);
  console.log(`  new / merged    : ${stats.newJobs ?? 0} / ${stats.mergedJobs ?? 0}`);
  console.log(`  active / expired: ${stats.activeJobs ?? 0} / ${stats.expired ?? 0}`);
  console.log(`  AI              : ${run.ai?.status || 'not_configured'}`);
  console.log('');

  const rows = Object.entries(run.sourceStats || {}).map(([source, value]) => ({
    source,
    status: value.status,
    jobs: value.jobs,
    scanned: value.scanned,
    warnings: value.warnings,
    ms: value.durationMs
  }));
  console.table(rows);

  const errors = run.sourceErrors || [];
  if (errors.length) {
    console.log('Source warnings/errors (expected when a board is empty, restricted or offline):');
    for (const error of errors.slice(0, 30)) {
      console.log(`  - ${error.source}${error.board ? `/${error.board}` : ''}: ${error.message}`);
    }
    if (errors.length > 30) console.log(`  … ${errors.length - 30} more`);
    console.log('');
  }

  const jobs = store.get().jobs
    .filter((job) => job.active !== false)
    .sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0))
    .slice(0, 10);

  if (!jobs.length) {
    console.log('No matching active jobs were returned. This can be normal for narrow titles,');
    console.log('young boards, rate limits or a source that is temporarily unavailable.');
    return;
  }

  console.log('Top matches');
  for (const job of jobs) {
    console.log(`  ${String(job.match?.score ?? '-').padStart(3)}  ${job.title} — ${job.company}`);
    console.log(`       ${job.location || 'Location not specified'} · ${job.workMode || 'unknown'} · ${job.sourceLabel || job.source} · ${job.match?.method || 'unscored'}`);
    console.log(`       ${job.url}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
    else if (arg.startsWith('--')) out[arg.slice(2)] = true;
  }
  return out;
}
