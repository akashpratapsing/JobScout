import test from 'node:test';
import assert from 'node:assert/strict';
import greenhouse from '../server/jobs/connectors/greenhouse.js';
import lever from '../server/jobs/connectors/lever.js';
import ashby from '../server/jobs/connectors/ashby.js';
import workday from '../server/jobs/connectors/workday.js';
import remoteok from '../server/jobs/connectors/remoteok.js';
import adzuna from '../server/jobs/connectors/adzuna.js';
import himalayas from '../server/jobs/connectors/himalayas.js';
import { makeCtx, makePreferences, mockHttp } from './helpers.js';

function ctxWith(http, preferences) {
  return makeCtx({ http, preferences: preferences || makePreferences({ titles: ['Backend Engineer'] }) });
}

test('Greenhouse maps the list and detail endpoints', async () => {
  const http = mockHttp({
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=false': {
      jobs: [{
        id: 101,
        title: 'Backend Engineer',
        absolute_url: 'https://boards.greenhouse.io/acme/jobs/101',
        location: { name: 'Bengaluru, India' },
        first_published: '2026-10-01',
        metadata: [{ name: 'Salary', value: '₹25L–₹35L' }]
      }]
    },
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/101': {
      content: '<p>Requirements: Python, AWS, Docker and PostgreSQL.</p>',
      location: { name: 'Bengaluru, India' },
      requisition_id: 'REQ-101',
      metadata: [{ name: 'Employment Type', value: 'Full-time' }]
    }
  });
  const result = await greenhouse.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    boards: { greenhouse: ['acme'] }
  })));

  assert.equal(result.jobs.length, 1);
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.warnings, []);
  const job = result.jobs[0];
  assert.equal(job.company, 'Acme');
  assert.equal(job.title, 'Backend Engineer');
  assert.equal(job.location, 'Bengaluru, India');
  assert.equal(job.requisitionId, 'REQ-101');
  assert.equal(job.salaryText, '₹25L–₹35L');
  assert.equal(job.employmentType, 'Full-time');
  assert.match(job.description, /Python/);
  assert.equal(job.sourceId, 'greenhouse:acme:101');
});

test('Lever maps postings, salary ranges and lists', async () => {
  const http = mockHttp({
    'https://api.lever.co/v0/postings/acme?mode=json': [{
      id: 'lever-1',
      text: 'Backend Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/lever-1',
      createdAt: '2026-10-02T00:00:00.000Z',
      categories: { location: 'Remote', commitment: 'Full-time', team: 'Platform' },
      descriptionPlain: 'Build services with Python and AWS.',
      lists: [{ text: 'Requirements', content: 'Docker, PostgreSQL' }],
      salaryRange: { min: 2500000, max: 3500000, currency: 'INR', interval: 'year' },
      workplaceType: 'remote'
    }]
  });
  const result = await lever.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    boards: { lever: ['acme'] }
  })));

  assert.equal(result.jobs.length, 1);
  const job = result.jobs[0];
  assert.equal(job.source, 'lever');
  assert.equal(job.workMode, 'remote');
  assert.equal(job.employmentType, 'Full-time');
  assert.match(job.description, /Docker, PostgreSQL/);
  assert.match(job.salaryText, /INR/);
  assert.equal(job.requisitionId, 'lever-1');
});

test('Ashby skips unlisted roles and combines secondary locations', async () => {
  const http = mockHttp({
    'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true': {
      jobs: [
        {
          id: 'ashby-1',
          title: 'Backend Engineer',
          location: 'Bengaluru, India',
          secondaryLocations: [{ location: 'Remote, India' }],
          jobUrl: 'https://jobs.ashbyhq.com/acme/1',
          publishedAt: '2026-10-03',
          descriptionHtml: '<p>Python, AWS and Docker.</p>',
          isRemote: true,
          employmentType: 'FullTime',
          compensation: { compensationTierSummary: '₹30L – ₹40L' }
        },
        { id: 'ashby-2', title: 'Backend Engineer', isListed: false, jobUrl: 'https://jobs.ashbyhq.com/acme/2' }
      ]
    }
  });
  const result = await ashby.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    boards: { ashby: ['acme'] }
  })));

  assert.equal(result.jobs.length, 1);
  assert.equal(result.scanned, 2);
  assert.match(result.jobs[0].location, /Bengaluru, India \/ Remote, India/);
  assert.equal(result.jobs[0].salaryText, '₹30L – ₹40L');
});

test('Workday resolves relative external URLs and drops closed postings', async () => {
  const http = mockHttp({
    'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs': {
      jobPostings: [
        { title: 'Backend Engineer', externalPath: '/job/Bengaluru/Backend_REQ-1', locationsText: 'Bengaluru, India', postedOn: '2026-10-01', bulletFields: ['REQ-1'] },
        { title: 'Backend Engineer', externalPath: '/job/Bengaluru/Closed_REQ-2', locationsText: 'Bengaluru, India', postedOn: '2026-10-01', bulletFields: ['REQ-2'] }
      ]
    },
    'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Bengaluru/Backend_REQ-1': {
      jobPostingInfo: {
        jobDescription: '<p>Python, AWS and Docker.</p>',
        location: 'Bengaluru, India',
        jobRequisitionId: 'REQ-1',
        startDate: '2026-10-01',
        timeType: 'Full time',
        externalUrl: '/en-US/External/job/Bengaluru/Backend_REQ-1'
      }
    },
    'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Bengaluru/Closed_REQ-2': {
      jobPostingInfo: { jobDescription: 'Old role', location: 'Bengaluru, India', canApply: false }
    }
  });
  const result = await workday.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    boards: {
      workday: [{ tenant: 'acme', wd: 'wd5', site: 'External', label: 'Acme' }]
    }
  })));

  assert.equal(result.jobs.length, 1);
  const job = result.jobs[0];
  assert.equal(job.company, 'Acme');
  assert.match(job.url, /^https:\/\/acme\.wd5\.myworkdayjobs\.com\/en-US\/External\/job\/Bengaluru\/Backend_REQ-1$/);
  assert.ok(result.warnings.some((warning) => /no longer accepting/i.test(warning.message)));
});

test('Remote OK maps the public feed and ignores metadata rows', async () => {
  const http = mockHttp({
    'https://remoteok.com/api': [
      { legal: 'metadata' },
      {
        id: 'remoteok-1',
        position: 'Backend Engineer',
        company: 'Acme',
        location: 'Remote',
        url: 'https://remoteok.com/remote-jobs/1',
        date: '2026-10-01',
        description: 'Python AWS Docker',
        salary_min: 100000,
        salary_max: 140000,
        tags: ['python', 'aws']
      }
    ]
  });
  const result = await remoteok.fetchJobs(ctxWith(http));
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].workMode, 'remote');
  assert.match(result.jobs[0].salaryText, /\$100000–\$140000/);
});

test('Adzuna reports a clear warning without credentials and builds the right URL with them', async () => {
  const without = await adzuna.fetchJobs(ctxWith(mockHttp({})));
  assert.equal(without.jobs.length, 0);
  assert.match(without.warnings[0].message, /app ID\/key/i);

  const http = mockHttp({
    'https://api.adzuna.com/*': {
      results: [{
        id: 'adzuna-1',
        title: 'Backend Engineer',
        company: { display_name: 'Acme' },
        location: { display_name: 'Bengaluru, India' },
        redirect_url: 'https://www.adzuna.in/details/1',
        created: '2026-10-01T00:00:00Z',
        description: 'Python AWS Docker',
        salary_min: 2500000,
        salary_max: 3500000,
        contract_time: 'full_time'
      }]
    }
  });
  const result = await adzuna.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    countries: ['India'],
    adzuna: { appId: 'app', appKey: 'secret', country: 'in' }
  })));
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].source, 'adzuna');
  const called = http.calls.find((call) => call.kind === 'json');
  assert.match(called.url, /api\.adzuna\.com\/v1\/api\/jobs\/in\/search\/1\?/);
  assert.match(called.url, /app_id=app/);
  assert.match(called.url, /app_key=secret/);
});

test('Himalayas maps remote restrictions and salary', async () => {
  const http = mockHttp({
    'https://himalayas.app/jobs/api?limit=100': {
      jobs: [{
        title: 'Backend Engineer',
        companyName: 'Acme',
        locationRestrictions: ['India'],
        applicationLink: 'https://himalayas.app/jobs/1',
        guid: 'h-1',
        pubDate: '2026-10-01',
        description: 'Python AWS Docker',
        employmentType: 'Full-time',
        minSalary: 2500000,
        maxSalary: 3500000,
        currency: 'INR',
        salaryPeriod: 'year'
      }]
    }
  });
  const result = await himalayas.fetchJobs(ctxWith(http));
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].location, 'India');
  assert.match(result.jobs[0].salaryText, /INR/);
});

test('one failing board is reported as a warning, not a thrown source error', async () => {
  const http = mockHttp({
    'https://boards-api.greenhouse.io/v1/boards/broken/jobs?content=false': new Error('HTTP 500'),
    'https://boards-api.greenhouse.io/v1/boards/good/jobs?content=false': {
      jobs: [{
        id: 1,
        title: 'Backend Engineer',
        absolute_url: 'https://boards.greenhouse.io/good/jobs/1',
        location: { name: 'Bengaluru, India' },
        first_published: '2026-10-01'
      }]
    },
    'https://boards-api.greenhouse.io/v1/boards/good/jobs/1': {
      content: 'Python AWS Docker',
      location: { name: 'Bengaluru, India' }
    }
  });
  const result = await greenhouse.fetchJobs(ctxWith(http, makePreferences({
    titles: ['Backend Engineer'],
    boards: { greenhouse: ['broken', 'good'] }
  })));
  assert.equal(result.jobs.length, 1);
  assert.ok(result.warnings.some((warning) => /HTTP 500/.test(warning.message)));
});
