import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { startServer } from '../server/index.js';
import { tempDir, silentLogger } from './helpers.js';

const pdfBuffer = fs.readFileSync(new URL('./fixtures/sample-resume.pdf', import.meta.url));

const CAREERS_HTML = `<!doctype html>
<html><head><title>Acme Careers</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "hiringOrganization": {"name": "Acme Labs"},
  "jobLocation": {"address": {"addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"}},
  "url": "/jobs/senior-backend",
  "identifier": "REQ-101",
  "datePosted": "2026-10-01",
  "description": "<h2>Requirements</h2><ul><li>5+ years of experience</li><li>Strong experience with Python, AWS, Docker and PostgreSQL</li><li>Kubernetes is a plus</li></ul><h2>Nice to have</h2><p>GraphQL</p>"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Data Engineer",
  "hiringOrganization": {"name": "Acme Labs"},
  "jobLocation": {"address": {"addressLocality": "Bengaluru", "addressCountry": "IN"}},
  "url": "/closed",
  "identifier": "REQ-102",
  "datePosted": "2026-10-02",
  "description": "<h2>Requirements</h2><p>Python, SQL and Airflow.</p>"
}
</script>
</head><body>Careers</body></html>`;

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    if (req.url === '/careers') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(CAREERS_HTML);
      return;
    }
    if (req.url === '/closed') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>This job posting has expired</h1></body></html>');
      return;
    }
    if (req.url.startsWith('/jobs/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Apply now</h1></body></html>');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><body>Not found</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('the local API supports the full resume, search and job workflow', async (t) => {
  const dataDir = tempDir('jobscout-api-');
  const fixture = await startFixtureServer();
  const app = await startServer({
    dataDir,
    port: 0,
    host: '127.0.0.1',
    schedulerEnabled: false,
    logger: silentLogger()
  });
  t.after(async () => {
    await app.stop();
    await fixture.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = app.url;

  async function api(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${pathname}`, { ...options, headers });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, headers: response.headers, data };
  }

  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.profile, false);

  const initial = await api('/api/state');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.app.name, 'JobScout');
  assert.equal(initial.data.profile, null);
  assert.ok(Array.isArray(initial.data.sources));
  assert.ok(initial.data.manual.sources.some((source) => source.id === 'naukri'));

  const form = new FormData();
  form.append('resume', new Blob([pdfBuffer], { type: 'application/pdf' }), 'sample-resume.pdf');
  const upload = await api('/api/resume/upload', { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  assert.equal(upload.data.profile.name, 'Aarav Sharma');
  assert.equal(upload.data.profile.resumeFileName, 'sample-resume.pdf');
  assert.equal(upload.data.profile.rawText, undefined);
  assert.ok(upload.data.profile.hasResumeText);
  assert.ok(upload.data.profile.completeness > 50);

  const stateAfterUpload = await api('/api/state');
  assert.equal(stateAfterUpload.data.profile.name, 'Aarav Sharma');
  assert.ok(stateAfterUpload.data.profile.experienceYears >= 5);

  // Edit the profile without re-uploading.
  const edited = {
    ...stateAfterUpload.data.profile,
    headline: 'Senior Backend Engineer',
    experienceYears: 5,
    experienceLevel: 'senior',
    skills: ['Python', 'JavaScript', 'TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'AWS', 'Docker', 'Kubernetes', 'Terraform', 'REST APIs', 'GraphQL', 'Git', 'Linux'],
    experience: [{
      title: 'Senior Backend Engineer',
      company: 'Nimbus Labs',
      start: 'Jan 2022',
      end: 'Present',
      description: 'Built Python services on AWS with Docker, Kubernetes and PostgreSQL.',
      technologies: ['Python', 'AWS', 'Docker', 'Kubernetes', 'PostgreSQL']
    }],
    education: [{ degree: 'B.Tech in Computer Science', institution: 'National Institute of Technology, Surathkal', year: '2019', field: '' }],
    projects: [{ name: 'JobScout', description: 'Node.js and Python job discovery service.', technologies: ['Node.js', 'Python'] }],
    certifications: ['AWS Certified Solutions Architect'],
    suggestedTitles: ['Senior Backend Engineer', 'Backend Engineer'],
    links: { linkedin: 'https://linkedin.com/in/aaravsharma', github: 'https://github.com/aaravsharma', other: [] }
  };
  delete edited.completeness;
  delete edited.hasResumeText;
  delete edited.resumeTextChars;
  const savedProfile = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ profile: edited }) });
  assert.equal(savedProfile.status, 200);
  assert.equal(savedProfile.data.profile.headline, 'Senior Backend Engineer');
  assert.ok(savedProfile.data.profile.skills.includes('AWS'));

  const prefs = await api('/api/preferences', {
    method: 'PUT',
    body: JSON.stringify({
      titles: ['Backend Engineer', 'Data Engineer'],
      locations: ['Bengaluru'],
      countries: ['India'],
      workModes: ['remote', 'hybrid', 'onsite'],
      maxAgeDays: 365,
      maxResults: 50,
      enabledSources: ['custom'],
      boards: { custom: [`${fixture.base}/careers`] }
    })
  });
  assert.equal(prefs.status, 200);
  assert.deepEqual(prefs.data.preferences.enabledSources, ['custom']);
  const customSource = prefs.data.sources.find((source) => source.id === 'custom');
  assert.equal(customSource.enabled, true);
  assert.equal(customSource.configured, true);

  const manual = await api('/api/manual-links');
  assert.equal(manual.status, 200);
  assert.match(manual.data.sources.find((source) => source.id === 'linkedin').url, /linkedin\.com\/jobs\/search/);

  const search = await api('/api/search', { method: 'POST', body: '{}' });
  assert.equal(search.status, 202);
  assert.ok(search.data.runId);

  let run = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await api(`/api/runs/${search.data.runId}`);
    assert.equal(response.status, 200);
    run = response.data.run;
    if (run.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(run, 'expected a run');
  assert.equal(run.status, 'completed');
  assert.equal(run.reason, 'manual');
  assert.equal(run.sourceStats.custom.status, 'ok');
  assert.ok(run.sourceStats.custom.jobs >= 2);
  assert.equal(run.ai.status, 'not_configured');
  assert.ok(run.stats.newJobs >= 2);

  const jobsResponse = await api('/api/jobs?status=all&includeExpired=1&limit=50');
  assert.equal(jobsResponse.status, 200);
  assert.ok(jobsResponse.data.total >= 2);
  const senior = jobsResponse.data.jobs.find((job) => job.requisitionId === 'REQ-101');
  const dataJob = jobsResponse.data.jobs.find((job) => job.requisitionId === 'REQ-102');
  assert.ok(senior);
  assert.ok(dataJob);
  assert.equal(senior.company, 'Acme Labs');
  assert.match(senior.url, /\/jobs\/senior-backend$/);
  assert.ok(senior.match.score > 0);
  assert.equal(senior.match.method, 'rules');
  assert.ok(senior.match.why.length > 20);
  assert.ok(senior.requiredSkills.includes('Python'));
  assert.ok(senior.requiredSkills.includes('AWS'));

  const saved = await api(`/api/jobs/${senior.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'saved', notes: 'Good fit' })
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.job.status, 'saved');
  assert.equal(saved.data.job.notes, 'Good fit');
  assert.ok(saved.data.job.savedAt);
  assert.deepEqual(saved.data.job.statusHistory.map((entry) => entry.status), ['saved']);

  const applied = await api(`/api/jobs/${senior.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'applied' })
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.job.status, 'applied');
  assert.ok(applied.data.job.appliedAt);
  assert.deepEqual(applied.data.job.statusHistory.map((entry) => entry.status), ['saved', 'applied']);

  const invalidStatus = await api(`/api/jobs/${senior.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'hired' })
  });
  assert.equal(invalidStatus.status, 400);

  const verified = await api(`/api/jobs/${dataJob.id}/verify`, { method: 'POST', body: '{}' });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.verification.checked, true);
  assert.equal(verified.data.verification.expired, true);
  assert.equal(verified.data.job.active, false);
  assert.match(verified.data.job.expiredReason, /closed/i);

  const appliedOnly = await api('/api/jobs?status=applied');
  assert.equal(appliedOnly.status, 200);
  assert.deepEqual(appliedOnly.data.jobs.map((job) => job.id), [senior.id]);

  const defaultList = await api('/api/jobs');
  assert.ok(defaultList.data.jobs.every((job) => job.active !== false));
  assert.ok(defaultList.data.jobs.every((job) => job.status !== 'dismissed'));

  const history = await api('/api/runs');
  assert.ok(history.data.runs.some((item) => item.id === search.data.runId));

  const exportResponse = await api('/api/export');
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.data.data.profile.name, 'Aarav Sharma');
  assert.equal(exportResponse.data.data.settings.ai.apiKeyEnc, undefined);
  assert.equal(exportResponse.data.data.settings.credentials, undefined);

  const crossOrigin = await api('/api/preferences', {
    method: 'PUT',
    headers: { origin: 'http://evil.example' },
    body: JSON.stringify({ titles: ['Hacked'] })
  });
  assert.equal(crossOrigin.status, 403);

  const missing = await api('/api/jobs/does-not-exist');
  assert.equal(missing.status, 404);

  const staticPage = await api('/');
  assert.equal(staticPage.status, 200);
  assert.match(String(staticPage.data), /JobScout/);
  const traversal = await api('/server/index.js');
  assert.equal(traversal.status, 404);

  const deleteResume = await api('/api/privacy/delete', {
    method: 'POST',
    body: JSON.stringify({ scope: 'resume' })
  });
  assert.equal(deleteResume.status, 200);
  assert.equal(deleteResume.data.profile, null);

  const searchWithoutProfile = await api('/api/search', { method: 'POST', body: '{}' });
  assert.equal(searchWithoutProfile.status, 400);
  assert.match(searchWithoutProfile.data.error, /resume/i);

  const deleteAll = await api('/api/privacy/delete', {
    method: 'POST',
    body: JSON.stringify({ scope: 'everything' })
  });
  assert.equal(deleteAll.status, 200);
  assert.equal(deleteAll.data.profile, null);
  assert.equal(deleteAll.data.stats.total, 0);
});
