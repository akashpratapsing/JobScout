import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import custom from '../server/jobs/connectors/custom.js';
import { createHttp } from '../server/jobs/http.js';
import { makeCtx, makePreferences, silentLogger } from './helpers.js';

const CAREERS_HTML = `<!doctype html>
<html><head><title>Careers</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "hiringOrganization": {"@type": "Organization", "name": "Acme Labs"},
  "jobLocation": {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"}},
  "url": {"@id": "/jobs/senior-backend"},
  "identifier": {"@type": "PropertyValue", "value": "REQ-101"},
  "datePosted": "2026-10-01",
  "validThrough": "2026-12-01",
  "description": "<p>We need Python, AWS, PostgreSQL and Docker.</p>",
  "baseSalary": {"@type": "MonetaryAmount", "currency": "INR", "value": {"@type": "QuantitativeValue", "minValue": 2500000, "maxValue": 3500000, "unitText": "YEAR"}},
  "employmentType": "FULL_TIME",
  "jobLocationType": "TELECOMMUTE"
}
</script>
<script type="application/ld+json">
{"@graph": [
  {"@type": "JobPosting", "title": "Expired Role", "hiringOrganization": "OldCo", "url": "/jobs/old", "validThrough": "2020-01-01", "description": "Old"},
  {"@type": "JobPosting", "title": "Data Engineer", "hiringOrganization": {"name": "Acme Labs"}, "jobLocation": {"address": {"addressLocality": "Pune", "addressCountry": "IN"}}, "url": "https://example.com/jobs/data", "identifier": "REQ-102", "description": "Python, SQL, Airflow"}
]}
</script>
<script type="application/ld+json">{ not valid json</script>
</head><body>Careers</body></html>`;

test('custom JSON-LD connector handles object/relative URLs, salaries and expiry', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\nDisallow: /blocked\n');
      return;
    }
    if (req.url === '/careers') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(CAREERS_HTML);
      return;
    }
    if (req.url === '/blocked') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Should not be fetched</body></html>');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><body>Not found</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const httpClient = createHttp(silentLogger());
  const preferences = makePreferences({
    titles: ['Backend Engineer', 'Data Engineer'],
    boards: { custom: [`${base}/careers`] }
  });
  const result = await custom.fetchJobs(makeCtx({ http: httpClient, preferences }));

  assert.deepEqual(result.warnings, []);
  assert.equal(result.scanned, 3);
  assert.equal(result.jobs.length, 2);

  const senior = result.jobs.find((job) => job.requisitionId === 'REQ-101');
  assert.ok(senior, 'expected the senior posting');
  assert.equal(senior.company, 'Acme Labs');
  assert.equal(senior.location, 'Bengaluru, Karnataka, IN');
  assert.equal(senior.url, `${base}/jobs/senior-backend`);
  assert.equal(senior.remote, true);
  assert.equal(senior.workMode, 'remote');
  assert.equal(senior.employmentType, 'Full-time');
  assert.match(senior.salaryText, /INR/);
  assert.match(senior.salaryText, /2500000/);
  assert.match(senior.sourceId, /^custom:127\.0\.0\.1:\d+:REQ-101$/);
  assert.equal(senior.sourceMeta.pageUrl, `${base}/careers`);
  assert.equal(senior.sourceMeta.validThrough, '2026-12-01T00:00:00.000Z');

  const data = result.jobs.find((job) => job.requisitionId === 'REQ-102');
  assert.ok(data, 'expected the data posting');
  assert.equal(data.url, 'https://example.com/jobs/data');
  assert.equal(data.location, 'Pune, IN');
  assert.match(data.description, /Airflow/);
});

test('custom connector respects robots.txt and reports blocked pages', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /blocked\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(CAREERS_HTML);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const result = await custom.fetchJobs(makeCtx({
    http: createHttp(silentLogger()),
    preferences: makePreferences({
      titles: ['Backend Engineer'],
      boards: { custom: [`${base}/blocked`] }
    })
  }));

  assert.equal(result.jobs.length, 0);
  assert.ok(result.warnings.some((warning) => /robots\.txt/i.test(warning.message)));
});

test('custom connector rejects malformed configured URLs without failing', async () => {
  const result = await custom.fetchJobs(makeCtx({
    http: createHttp(silentLogger()),
    preferences: makePreferences({
      titles: ['Backend Engineer'],
      boards: { custom: ['not a url', 'ftp://example.com/careers'] }
    })
  }));
  assert.equal(result.jobs.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every((warning) => /Invalid career page URL/i.test(warning.message)));
});

test('custom connector reports a page with no JobPosting JSON-LD honestly', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Careers</h1><p>We are hiring.</p></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const result = await custom.fetchJobs(makeCtx({
    http: createHttp(silentLogger()),
    preferences: makePreferences({
      titles: ['Backend Engineer'],
      boards: { custom: [`${base}/careers`] }
    })
  }));
  assert.equal(result.jobs.length, 0);
  assert.ok(result.warnings.some((warning) => /No JobPosting JSON-LD/i.test(warning.message)));
});
