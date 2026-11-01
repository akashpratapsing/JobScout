import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PREFERENCES } from '../server/lib/store.js';
import { createHttp } from '../server/jobs/http.js';
import { prefilter, rankForQuery } from '../server/jobs/connectors/common.js';
import { canonicalUrl } from '../server/lib/util.js';

export function makePreferences(overrides = {}) {
  const base = structuredClone(DEFAULT_PREFERENCES);
  const merged = { ...base, ...overrides };
  merged.boards = { ...base.boards, ...(overrides.boards || {}) };
  merged.titles = overrides.titles ?? ['Software Engineer'];
  merged.locations = overrides.locations ?? [];
  merged.countries = overrides.countries ?? [];
  merged.workModes = overrides.workModes ?? ['remote', 'hybrid', 'onsite'];
  merged.maxAgeDays = overrides.maxAgeDays ?? 365;
  merged.maxResults = overrides.maxResults ?? 150;
  merged.adzuna = { appId: '', appKey: '', country: 'in', ...(overrides.adzuna || {}) };
  return merged;
}

export function makeCtx({ preferences = makePreferences(), titles = preferences.titles, http = createHttp(null) } = {}) {
  const ctx = {
    http,
    preferences,
    titles,
    maxBoards: 30,
    perBoard: 6,
    maxPerFeed: 80
  };
  ctx.prefilter = (raw) => prefilter(raw, { preferences, titles });
  ctx.rank = (raw) => rankForQuery(raw, { titles });
  return ctx;
}

/**
 * Minimal HttpClient stand-in. Handlers may be exact URLs, a prefix ending in
 * "*", or a function. A handler can return a value or throw.
 */
export function mockHttp(handlers = {}) {
  const calls = [];
  const find = (url) => {
    if (typeof handlers === 'function') return handlers;
    if (Object.prototype.hasOwnProperty.call(handlers, url)) return handlers[url];
    for (const [key, value] of Object.entries(handlers)) {
      if (key.endsWith('*') && url.startsWith(key.slice(0, -1))) return value;
    }
    return undefined;
  };
  const run = async (kind, url, options) => {
    calls.push({ kind, url, options });
    const handler = find(url);
    if (handler == null) throw new Error(`No mock handler for ${kind} ${url}`);
    if (handler instanceof Error) throw handler;
    if (typeof handler === 'function') return handler(url, options);
    return handler;
  };
  return {
    calls,
    json: (url, options) => run('json', url, options),
    text: (url, options) => run('text', url, options),
    robotsAllowed: async (url) => {
      calls.push({ kind: 'robots', url });
      const handler = handlers.robots;
      if (handler === undefined) return true;
      return typeof handler === 'function' ? handler(url) : Boolean(handler);
    },
    request: async (url, options) => {
      calls.push({ kind: 'request', url, options });
      const handler = handlers.request;
      if (!handler) throw new Error(`No mock request handler for ${url}`);
      return typeof handler === 'function' ? handler(url, options) : handler;
    }
  };
}

export function makeJob(overrides = {}) {
  const job = {
    id: overrides.id || 'job-1',
    source: 'greenhouse',
    sourceLabel: 'Greenhouse',
    board: 'acme',
    title: 'Senior Backend Engineer',
    company: 'Acme Labs',
    location: 'Bengaluru, India',
    country: 'India',
    workMode: 'hybrid',
    remote: false,
    employmentType: 'Full-time',
    experienceRequired: '5+ years',
    salaryText: '',
    description: 'Build Python services with AWS, Docker, PostgreSQL and Redis. 5+ years of experience required.',
    summary: 'Build backend services.',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1',
    requisitionId: 'REQ-1',
    postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    firstSeenAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    active: true,
    expiredAt: null,
    tags: ['backend'],
    descriptionHash: 'hash-1',
    sourceMeta: {},
    status: 'new',
    ...overrides
  };
  // When a test changes the URL, derive the canonical URL from it unless the
  // test explicitly overrides canonicalUrl (including setting it to undefined).
  if (!Object.prototype.hasOwnProperty.call(overrides, 'canonicalUrl')) {
    job.canonicalUrl = canonicalUrl(job.url);
  }
  return job;
}

export function makeProfile(overrides = {}) {
  return {
    name: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
    phone: '+91 98765 43210',
    location: 'Bengaluru, India',
    headline: 'Senior Backend Engineer',
    summary: 'Backend engineer with 5 years of experience.',
    skills: [
      'Python', 'JavaScript', 'TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'AWS',
      'Docker', 'Kubernetes', 'Terraform', 'REST APIs', 'GraphQL', 'Git', 'Linux'
    ],
    experienceYears: 5,
    experienceLevel: 'senior',
    experience: [{
      title: 'Senior Backend Engineer',
      company: 'Nimbus Labs',
      start: 'Jan 2022',
      end: 'Present',
      description: 'Python, FastAPI, Kafka, Redis, AWS, Kubernetes and Terraform.',
      technologies: ['Python', 'AWS', 'Kubernetes', 'Terraform']
    }],
    projects: [{
      name: 'JobScout',
      description: 'Node.js service that normalizes job feeds and scores fit.',
      technologies: ['Node.js', 'Python', 'PostgreSQL']
    }],
    education: [{ degree: 'B.Tech in Computer Science', institution: 'National Institute of Technology, Surathkal', year: '2019', field: '' }],
    certifications: ['AWS Certified Solutions Architect - Associate'],
    keywords: [],
    suggestedTitles: ['Senior Backend Engineer', 'Backend Engineer'],
    links: { linkedin: '', github: '', other: [] },
    ...overrides
  };
}

export function tempDir(prefix = 'jobscout-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    sourceError() {}
  };
}
