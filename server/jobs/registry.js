import greenhouse from './connectors/greenhouse.js';
import lever from './connectors/lever.js';
import ashby from './connectors/ashby.js';
import workday from './connectors/workday.js';
import workable from './connectors/workable.js';
import recruitee from './connectors/recruitee.js';
import smartrecruiters from './connectors/smartrecruiters.js';
import remoteok from './connectors/remoteok.js';
import remotive from './connectors/remotive.js';
import weworkremotely from './connectors/weworkremotely.js';
import himalayas from './connectors/himalayas.js';
import arbeitnow from './connectors/arbeitnow.js';
import jobicy from './connectors/jobicy.js';
import adzuna from './connectors/adzuna.js';
import custom from './connectors/custom.js';

export const CONNECTORS = {
  greenhouse, lever, ashby, workday, workable, recruitee, smartrecruiters,
  remoteok, remotive, weworkremotely, himalayas, arbeitnow, jobicy, adzuna, custom
};

export const SOURCE_CATALOG = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    group: 'ATS',
    method: greenhouse.method,
    docsUrl: greenhouse.docsUrl,
    notes: greenhouse.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'greenhouse',
    configType: 'tokens',
    coverage: 'Company-hosted roles worldwide, strongest for startups and product companies.'
  },
  {
    id: 'lever',
    label: 'Lever',
    group: 'ATS',
    method: lever.method,
    docsUrl: lever.docsUrl,
    notes: lever.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'lever',
    configType: 'tokens',
    coverage: 'Company-hosted roles worldwide, including several Indian product companies.'
  },
  {
    id: 'ashby',
    label: 'Ashby',
    group: 'ATS',
    method: ashby.method,
    docsUrl: ashby.docsUrl,
    notes: ashby.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'ashby',
    configType: 'tokens',
    coverage: 'Company-hosted roles, strong for AI/ML and high-growth startups.'
  },
  {
    id: 'workday',
    label: 'Workday',
    group: 'ATS',
    method: workday.method,
    docsUrl: workday.docsUrl,
    notes: workday.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'workday',
    configType: 'workday',
    coverage: 'Large enterprises and MNCs. Each employer needs its own tenant/site.'
  },
  {
    id: 'workable',
    label: 'Workable',
    group: 'ATS',
    method: workable.method,
    docsUrl: workable.docsUrl,
    notes: workable.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'workable',
    configType: 'tokens',
    coverage: 'SMB and mid-market companies. Some boards return an empty public feed.'
  },
  {
    id: 'recruitee',
    label: 'Recruitee',
    group: 'ATS',
    method: recruitee.method,
    docsUrl: recruitee.docsUrl,
    notes: recruitee.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'recruitee',
    configType: 'tokens',
    coverage: 'European and global companies using Recruitee career sites.'
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    group: 'ATS',
    method: smartrecruiters.method,
    docsUrl: smartrecruiters.docsUrl,
    notes: smartrecruiters.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'smartrecruiters',
    configType: 'tokens',
    coverage: 'Best-effort only. Public access is restricted for many tenants; zero results are reported honestly.'
  },
  {
    id: 'remoteok',
    label: 'Remote OK',
    group: 'Remote feed',
    method: remoteok.method,
    docsUrl: remoteok.docsUrl,
    notes: remoteok.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'Remote roles worldwide.'
  },
  {
    id: 'remotive',
    label: 'Remotive',
    group: 'Remote feed',
    method: remotive.method,
    docsUrl: remotive.docsUrl,
    notes: remotive.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'Remote roles with location restrictions and salary hints.'
  },
  {
    id: 'weworkremotely',
    label: 'We Work Remotely',
    group: 'Remote feed',
    method: weworkremotely.method,
    docsUrl: weworkremotely.docsUrl,
    notes: weworkremotely.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'Remote programming, design, marketing and support roles.'
  },
  {
    id: 'himalayas',
    label: 'Himalayas',
    group: 'Remote feed',
    method: himalayas.method,
    docsUrl: himalayas.docsUrl,
    notes: himalayas.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'Remote roles with country restrictions and salary ranges.'
  },
  {
    id: 'arbeitnow',
    label: 'Arbeitnow',
    group: 'International feed',
    method: arbeitnow.method,
    docsUrl: arbeitnow.docsUrl,
    notes: arbeitnow.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'European roles, especially Germany; some remote roles.'
  },
  {
    id: 'jobicy',
    label: 'Jobicy',
    group: 'Remote feed',
    method: jobicy.method,
    docsUrl: jobicy.docsUrl,
    notes: jobicy.notes,
    integrated: true,
    needsConfig: false,
    coverage: 'Remote roles across regions and industries.'
  },
  {
    id: 'adzuna',
    label: 'Adzuna',
    group: 'Search API',
    method: adzuna.method,
    docsUrl: adzuna.docsUrl,
    notes: adzuna.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'adzuna',
    configType: 'adzuna',
    coverage: 'India and 20+ countries. Requires a free Adzuna app ID/key.'
  },
  {
    id: 'custom',
    label: 'Company career pages',
    group: 'Direct',
    method: custom.method,
    docsUrl: custom.docsUrl,
    notes: custom.notes,
    integrated: true,
    needsConfig: true,
    configKey: 'custom',
    configType: 'urls',
    coverage: 'Any career page that publishes schema.org JobPosting JSON-LD and allows crawling.'
  }
];

export const MANUAL_SOURCES = [
  {
    id: 'linkedin',
    label: 'LinkedIn Jobs',
    reason: 'No public jobs API. LinkedIn\'s terms prohibit automated scraping, so JobScout does not fetch it.',
    searchUrl: (q, l) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(l)}`
  },
  {
    id: 'indeed',
    label: 'Indeed',
    reason: 'No public jobs API for this use case. Indeed\'s terms restrict automated access, so JobScout does not fetch it.',
    searchUrl: (q, l) => `https://www.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}`
  },
  {
    id: 'glassdoor',
    label: 'Glassdoor',
    reason: 'No public jobs API; automated access is restricted by Glassdoor\'s terms.',
    searchUrl: (q, l) => `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}&locT=C&locId=&city=${encodeURIComponent(l)}`
  },
  {
    id: 'dice',
    label: 'Dice',
    reason: 'No public jobs API; Dice\'s terms restrict automated access.',
    searchUrl: (q, l) => `https://www.dice.com/jobs?q=${encodeURIComponent(q)}&location=${encodeURIComponent(l)}`
  },
  {
    id: 'naukri',
    label: 'Naukri',
    reason: 'No public jobs API. Naukri\'s terms prohibit scraping; use the search link and apply manually.',
    searchUrl: (q, l) => `https://www.naukri.com/${encodeURIComponent(String(q).toLowerCase().replace(/\s+/g, '-'))}-jobs-in-${encodeURIComponent(String(l || 'india').toLowerCase().replace(/\s+/g, '-'))}`
  },
  {
    id: 'foundit',
    label: 'Foundit',
    reason: 'No public jobs API; automated access is restricted. Use the search link.',
    searchUrl: (q, l) => `https://www.foundit.in/srp/results?query=${encodeURIComponent(q)}&locations=${encodeURIComponent(l)}`
  },
  {
    id: 'instahyre',
    label: 'Instahyre',
    reason: 'Invite/account-based platform with no public jobs API.',
    searchUrl: (q) => `https://www.instahyre.com/search-jobs/?q=${encodeURIComponent(q)}`
  },
  {
    id: 'hirist',
    label: 'Hirist',
    reason: 'No public jobs API; automated access is restricted.',
    searchUrl: (q) => `https://www.hirist.tech/search?q=${encodeURIComponent(q)}`
  },
  {
    id: 'cutshort',
    label: 'Cutshort',
    reason: 'No public jobs API; account-based platform.',
    searchUrl: (q) => `https://cutshort.io/jobs?search=${encodeURIComponent(q)}`
  },
  {
    id: 'wellfound',
    label: 'Wellfound',
    reason: 'No public jobs API; automated access is restricted by their terms.',
    searchUrl: (q) => `https://wellfound.com/jobs?query=${encodeURIComponent(q)}`
  }
];

export const BOARD_LABELS = {
  stripe: 'Stripe', vercel: 'Vercel', datadog: 'Datadog', cloudflare: 'Cloudflare',
  elastic: 'Elastic', gitlab: 'GitLab', figma: 'Figma', reddit: 'Reddit', discord: 'Discord',
  coinbase: 'Coinbase', brex: 'Brex', robinhood: 'Robinhood', instacart: 'Instacart',
  duolingo: 'Duolingo', thoughtworks: 'Thoughtworks', groww: 'Groww', slice: 'Slice',
  netlify: 'Netlify', airtable: 'Airtable', mixpanel: 'Mixpanel', coursera: 'Coursera',
  contentful: 'Contentful', paytm: 'Paytm', meesho: 'Meesho', cred: 'CRED', spotify: 'Spotify',
  outreach: 'Outreach', openai: 'OpenAI', ramp: 'Ramp', notion: 'Notion', linear: 'Linear',
  supabase: 'Supabase', elevenlabs: 'ElevenLabs', perplexity: 'Perplexity', cursor: 'Cursor',
  cohere: 'Cohere', vanta: 'Vanta', sentry: 'Sentry', posthog: 'PostHog', replit: 'Replit',
  warp: 'Warp', blueground: 'Blueground', bunq: 'bunq', gorgias: 'Gorgias'
};

export function boardLabel(source, token) {
  return BOARD_LABELS[token] || String(token).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sourceCatalogForUi() {
  return SOURCE_CATALOG.map((s) => ({ ...s }));
}
