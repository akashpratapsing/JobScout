import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const DEFAULT_PREFERENCES = {
  titles: [],
  locations: [],
  countries: ['India'],
  workModes: ['remote', 'hybrid', 'onsite'],
  experienceLevels: [],
  employmentTypes: [],
  minSalary: null,
  currency: 'INR',
  technologies: [],
  includeCompanies: [],
  excludeCompanies: [],
  industries: [],
  maxResults: 150,
  maxAgeDays: 45,
  dailyEnabled: false,
  dailyTime: '09:00',
  dailyTimezone: 'Asia/Kolkata',
  enabledSources: [
    'greenhouse', 'lever', 'ashby', 'workday', 'workable', 'recruitee',
    'remoteok', 'remotive', 'weworkremotely', 'himalayas', 'arbeitnow', 'jobicy',
    'smartrecruiters', 'custom'
  ],
  boards: {
    greenhouse: ['stripe', 'vercel', 'datadog', 'cloudflare', 'elastic', 'gitlab', 'figma', 'reddit', 'discord', 'coinbase', 'brex', 'robinhood', 'instacart', 'duolingo', 'thoughtworks', 'groww', 'slice', 'netlify', 'airtable', 'mixpanel', 'coursera', 'contentful'],
    lever: ['paytm', 'meesho', 'cred', 'spotify', 'outreach'],
    ashby: ['openai', 'ramp', 'notion', 'linear', 'supabase', 'elevenlabs', 'perplexity', 'cursor', 'cohere', 'vanta', 'sentry', 'posthog', 'replit', 'warp'],
    workday: [
      { tenant: 'salesforce', wd: 'wd12', site: 'External_Career_Site', label: 'Salesforce' },
      { tenant: 'accenture', wd: 'wd103', site: 'AccentureCareers', label: 'Accenture' },
      { tenant: 'capitalone', wd: 'wd12', site: 'Capital_One', label: 'Capital One' }
    ],
    workable: ['blueground'],
    recruitee: ['bunq', 'gorgias'],
    smartrecruiters: [],
    custom: []
  },
  adzuna: { appId: '', appKey: '', country: 'in' }
};

export const DEFAULT_SETTINGS = {
  ai: {
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    apiKeyEnc: null,
    baseUrl: '',
    enabled: false,
    freeOnly: true,
    cooldownUntil: null,
    lastError: null,
    lastSuccessAt: null,
    lastTestAt: null,
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0
  },
  schedule: {
    enabled: false,
    time: '09:00',
    timezone: 'Asia/Kolkata',
    lastRunDate: null
  },
  credentials: {
    adzunaAppKeyEnc: null
  },
  privacy: {
    sendFullResumeText: true,
    keepResumeText: true
  }
};

function defaultState() {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile: null,
    preferences: structuredClone(DEFAULT_PREFERENCES),
    settings: structuredClone(DEFAULT_SETTINGS),
    jobs: [],
    runs: [],
    sourceState: {},
    meta: {
      lastSearchAt: null,
      lastSearchStatus: null,
      lastScheduledDate: null,
      totalSearches: 0
    }
  };
}

function mergeDefaults(defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : structuredClone(defaults);
  if (defaults && typeof defaults === 'object') {
    const out = { ...structuredClone(defaults) };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, val] of Object.entries(value)) {
        out[key] = key in defaults ? mergeDefaults(defaults[key], val) : val;
      }
    }
    return out;
  }
  return value === undefined ? defaults : value;
}

export class Store {
  constructor(dataDir = config.dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'app.json');
    this.backupDir = path.join(dataDir, 'backups');
    this.data = defaultState();
    this.writeChain = Promise.resolve();
    this.dirty = false;
  }

  async init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        ...defaultState(),
        ...parsed,
        preferences: mergeDefaults(DEFAULT_PREFERENCES, parsed.preferences),
        settings: mergeDefaults(DEFAULT_SETTINGS, parsed.settings),
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : []
      };
      this.backupDaily();
    } else {
      await this.persist();
    }
    return this;
  }

  backupDaily() {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const target = path.join(this.backupDir, `app-${day}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('app-')).sort();
      for (const old of files.slice(0, Math.max(0, files.length - 7))) {
        fs.rmSync(path.join(this.backupDir, old), { force: true });
      }
    } catch {
      // Backups are best-effort.
    }
  }

  get() {
    return this.data;
  }

  async persist() {
    const payload = JSON.stringify(this.data, null, 2);
    this.dirty = true;
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, payload, 'utf8');
      await fs.promises.rename(tmp, this.file);
      this.dirty = false;
    }).catch((error) => {
      this.dirty = true;
      throw error;
    });
    return this.writeChain;
  }

  async update(mutator) {
    const result = await mutator(this.data);
    await this.persist();
    return result;
  }

  async replaceState(next) {
    this.data = next;
    await this.persist();
  }

  async export() {
    return JSON.parse(JSON.stringify(this.data));
  }

  async reset() {
    this.data = defaultState();
    await this.persist();
    return this.data;
  }
}
