import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeJobs,
  isDuplicate,
  mergeJob,
  normalizeCompany,
  normalizeLocationKey,
  normalizeTitleKey,
  signatureKey,
  sourceRef
} from '../server/jobs/dedupe.js';
import { makeJob } from './helpers.js';

test('normalizes company, title and location keys', () => {
  assert.equal(normalizeCompany('Acme Labs, Inc.'), 'acme labs');
  assert.equal(normalizeCompany('Acme Technologies Pvt. Ltd.'), 'acme');
  assert.equal(normalizeTitleKey('Senior Backend Engineer (Remote)'), 'senior backend engineer');
  assert.equal(normalizeLocationKey('Bengaluru, India'), 'bengaluru|India');
  assert.equal(normalizeLocationKey('Bangalore, IN'), 'bengaluru|India');
});

test('the same canonical URL is a duplicate even with tracking parameters', () => {
  const a = makeJob({ url: 'https://boards.greenhouse.io/acme/jobs/1', canonicalUrl: undefined });
  const b = makeJob({
    source: 'lever',
    url: 'https://boards.greenhouse.io/acme/jobs/1?utm_source=linkedin&gh_src=abc',
    canonicalUrl: undefined,
    requisitionId: ''
  });
  assert.equal(isDuplicate(a, b), true);
});

test('different requisition IDs are never merged, even with identical titles', () => {
  const a = makeJob({ requisitionId: 'REQ-1' });
  const b = makeJob({
    id: 'job-2',
    source: 'lever',
    url: 'https://jobs.lever.co/acme/2',
    requisitionId: 'REQ-2',
    description: a.description
  });
  assert.equal(isDuplicate(a, b), false);
});

test('the same requisition across sources merges and keeps both source references', () => {
  const existing = makeJob({ source: 'greenhouse', requisitionId: 'REQ-9', description: 'Build Python services with AWS and Docker. '.repeat(20) });
  const incoming = makeJob({
    id: 'job-2',
    source: 'lever',
    sourceLabel: 'Lever',
    url: 'https://jobs.lever.co/acme/9',
    requisitionId: 'REQ-9',
    description: 'Build Python services with AWS and Docker. '.repeat(20)
  });
  assert.equal(isDuplicate(existing, incoming), true);
  const merged = mergeJob(existing, incoming);
  assert.equal(merged.sources.length, 2);
  assert.deepEqual(merged.sources.map((source) => source.source).sort(), ['greenhouse', 'lever']);
  assert.equal(merged.duplicateCount, 1);
});

test('similar titles in different locations are not merged', () => {
  const a = makeJob({ title: 'Senior Backend Engineer', location: 'Bengaluru, India', requisitionId: '' });
  const b = makeJob({
    id: 'job-2',
    title: 'Backend Engineer',
    location: 'Mumbai, India',
    url: 'https://boards.greenhouse.io/acme/jobs/2',
    requisitionId: ''
  });
  assert.equal(isDuplicate(a, b), false);
});

test('same company, title and location merge only when descriptions agree', () => {
  const a = makeJob({ requisitionId: '', description: 'Python AWS Docker PostgreSQL Kubernetes Terraform Redis Linux backend services.' });
  const similar = makeJob({
    id: 'job-2',
    url: 'https://boards.greenhouse.io/acme/jobs/2',
    requisitionId: '',
    description: 'Python AWS Docker PostgreSQL Kubernetes Terraform Redis Linux backend services.'
  });
  assert.equal(isDuplicate(a, similar), true);

  const different = makeJob({
    id: 'job-3',
    url: 'https://boards.greenhouse.io/acme/jobs/3',
    requisitionId: '',
    description: 'Sales quota account management prospecting CRM negotiation enterprise customers.'
  });
  assert.equal(isDuplicate(a, different), false);
});

test('a repeated search merges instead of duplicating', () => {
  const first = makeJob();
  const once = dedupeJobs([], [first]);
  assert.equal(once.added, 1);
  assert.equal(once.merged, 0);
  assert.equal(once.jobs.length, 1);

  const twice = dedupeJobs(once.jobs, [makeJob()]);
  assert.equal(twice.added, 0);
  assert.equal(twice.merged, 1);
  assert.equal(twice.jobs.length, 1);
});

test('a better-priority source can become primary without losing history', () => {
  const existing = makeJob({
    source: 'adzuna',
    sourceLabel: 'Adzuna',
    url: 'https://www.adzuna.in/land/12345',
    description: 'Short.',
    status: 'saved',
    notes: 'Follow up',
    firstSeenAt: '2026-01-01T00:00:00.000Z'
  });
  const incoming = makeJob({
    id: 'job-2',
    source: 'greenhouse',
    description: 'A much longer and more complete description of the same role. '.repeat(10)
  });
  const merged = mergeJob(existing, incoming);
  assert.equal(merged.source, 'greenhouse');
  assert.equal(merged.id, existing.id);
  assert.equal(merged.firstSeenAt, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.status, 'saved');
  assert.equal(merged.notes, 'Follow up');
  assert.ok(merged.sources.some((source) => source.source === 'adzuna'));
  assert.ok(merged.sources.some((source) => source.source === 'greenhouse'));
});

test('signature and source reference helpers expose stable keys', () => {
  const job = makeJob();
  assert.match(signatureKey(job), /^sig\|acme labs\|senior backend engineer\|/);
  const ref = sourceRef(job);
  assert.equal(ref.source, 'greenhouse');
  assert.equal(ref.requisitionId, 'REQ-1');
  assert.equal(ref.active, true);
});
