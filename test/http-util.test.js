import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, jsonFailure } from '../server/jobs/http.js';
import { canonicalUrl, parseDate, titleSimilarity, jaccard, hashText, oneLine, uniqueStrings, decodeEntities, stripHtml } from '../server/lib/util.js';

test('parses robots.txt groups for * and JobScout', () => {
  const rules = parseRobots(`
    # comment
    User-agent: Googlebot
    Disallow: /

    User-agent: *
    Disallow: /private
    Allow: /private/public

    User-agent: JobScout
    Disallow: /admin
  `);
  assert.equal(rules.length, 2);
  assert.equal(isAllowed(rules, '/jobs'), true);
  assert.equal(isAllowed(rules, '/private/secret'), false);
  assert.equal(isAllowed(rules, '/private/public/page'), true);
  assert.equal(isAllowed(rules, '/admin'), false);
});

test('jsonFailure explains HTML responses instead of blaming JSON', () => {
  const unavailable = jsonFailure('<!DOCTYPE html><html><title>Workday is currently unavailable.</title></html>', { source: 'Workday' });
  assert.match(unavailable.message, /HTML page instead of JSON/);
  assert.match(unavailable.message, /currently unavailable/);
  assert.equal(unavailable.source, 'Workday');

  const blocked = jsonFailure('  <html><body>Access denied</body></html>');
  assert.match(blocked.message, /blocked, rate-limited, moved/);

  const malformed = jsonFailure('{"jobs": [');
  assert.equal(malformed.message, 'Source returned invalid JSON.');
});

test('empty or wildcard-only robots.txt allows everything', () => {
  assert.equal(isAllowed([], '/anything'), true);
  const rules = parseRobots('User-agent: *\nDisallow:');
  assert.equal(isAllowed(rules, '/anything'), true);
});

test('canonicalUrl strips tracking, sorts parameters and normalizes the host', () => {
  assert.equal(
    canonicalUrl('https://WWW.Example.com/Jobs/123/?utm_source=x&b=2&a=1#apply'),
    'https://example.com/Jobs/123?a=1&b=2'
  );
  assert.equal(
    canonicalUrl('https://example.com/jobs/1?gh_src=abc&ref=linkedin&job_id=9'),
    'https://example.com/jobs/1?job_id=9'
  );
  assert.equal(canonicalUrl(''), '');
  assert.equal(canonicalUrl('not a url'), 'not a url');
});

test('parseDate handles ISO, epoch, relative and invalid dates', () => {
  assert.equal(parseDate('2026-10-01'), '2026-10-01T00:00:00.000Z');
  assert.equal(parseDate('2026-10-01 12:30'), '2026-10-01T12:30:00.000Z');
  assert.equal(parseDate(1759276800), '2025-10-01T00:00:00.000Z');
  assert.equal(parseDate('2026-10-01T00:00:00Z'), '2026-10-01T00:00:00.000Z');
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate('1800-01-01'), null);
  assert.equal(parseDate(''), null);

  const now = new Date('2026-10-30T12:00:00Z');
  assert.equal(parseDate('posted 3 days ago', now), '2026-10-27T12:00:00.000Z');
  assert.equal(parseDate('yesterday', now), '2026-10-29T12:00:00.000Z');
  assert.equal(parseDate('today', now), '2026-10-30T12:00:00.000Z');
});

test('text helpers normalize and compare safely', () => {
  assert.equal(decodeEntities('A &amp; B &mdash; C'), 'A & B — C');
  assert.equal(stripHtml('<p>Hello <b>world</b></p><script>bad()</script>'), 'Hello world');
  assert.equal(oneLine('  a \n\n b  ', 20), 'a b');
  assert.equal(uniqueStrings(['A', 'a', ' B ', 'B']).length, 3);
  assert.ok(jaccard('python aws docker', 'python aws kubernetes') > 0.4);
  assert.equal(titleSimilarity('Backend Engineer', 'Backend Engineer'), 1);
  assert.ok(titleSimilarity('Senior Backend Engineer', 'Backend Engineer') > 0.8);
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
});
