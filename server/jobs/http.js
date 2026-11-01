import { config } from '../lib/config.js';
import { sleep } from '../lib/util.js';

export class SourceError extends Error {
  constructor(message, { source, status, url, retryable = false } = {}) {
    super(message);
    this.name = 'SourceError';
    this.source = source;
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

const USER_AGENT = 'JobScout/1.0 (personal local job search; respects robots.txt and rate limits)';

export class HttpClient {
  constructor({ timeoutMs = config.discovery.requestTimeoutMs, delayMs = config.discovery.hostDelayMs, logger } = {}) {
    this.timeoutMs = timeoutMs;
    this.delayMs = delayMs;
    this.logger = logger;
    this.hosts = new Map();
    this.robotsCache = new Map();
    this.active = 0;
    this.queue = [];
    this.maxConcurrent = config.discovery.maxConcurrentRequests;
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async hostDelay(host) {
    const state = this.hosts.get(host) || { lastAt: 0, chain: Promise.resolve() };
    this.hosts.set(host, state);
    const previous = state.chain;
    let resolve;
    state.chain = new Promise((r) => { resolve = r; });
    await previous;
    const wait = Math.max(0, state.lastAt + this.delayMs - Date.now());
    if (wait > 0) await sleep(wait);
    state.lastAt = Date.now();
    return resolve;
  }

  async request(url, { method = 'GET', headers = {}, body, timeoutMs = this.timeoutMs, retries = 1, source = '', accept = 'application/json, text/plain, */*' } = {}) {
    const host = new URL(url).host;
    await this.acquire();
    const releaseHost = await this.hostDelay(host);
    try {
      let attempt = 0;
      while (true) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, {
            method,
            headers: {
              'user-agent': USER_AGENT,
              accept,
              ...headers
            },
            body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
            signal: controller.signal
          });
          const retryAfter = Number(response.headers.get('retry-after') || 0);
          if ((response.status === 429 || response.status === 503) && attempt < retries) {
            attempt += 1;
            const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 1500 * attempt;
            await sleep(waitMs);
            continue;
          }
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new SourceError(`${source || host} returned HTTP ${response.status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 180)}` : ''}`, {
              source,
              status: response.status,
              url,
              retryable: response.status === 429 || response.status >= 500
            });
          }
          return response;
        } catch (error) {
          if (error instanceof SourceError) throw error;
          if (error?.name === 'AbortError') {
            throw new SourceError(`${source || host} timed out after ${Math.round(timeoutMs / 1000)}s.`, { source, url, retryable: true });
          }
          if (attempt < retries) {
            attempt += 1;
            await sleep(800 * attempt);
            continue;
          }
          throw new SourceError(`${source || host} request failed: ${String(error.message || error).slice(0, 180)}`, { source, url, retryable: true });
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      releaseHost();
      this.release();
    }
  }

  async json(url, options = {}) {
    const response = await this.request(url, options);
    const text = await response.text();
    if (text.length > 30_000_000) throw new SourceError('Response was too large to process safely.', { source: options.source, url });
    try {
      return JSON.parse(text);
    } catch {
      throw jsonFailure(text, { source: options.source, url });
    }
  }

  async text(url, options = {}) {
    const response = await this.request(url, options);
    return response.text();
  }

  async robotsAllowed(url) {
    try {
      const target = new URL(url);
      const origin = target.origin;
      if (this.robotsCache.has(origin)) return this.robotsCache.get(origin)(target.pathname);
      let body = '';
      try {
        const response = await this.request(`${origin}/robots.txt`, { source: 'robots.txt', accept: 'text/plain', retries: 0, timeoutMs: 10000 });
        body = await response.text();
      } catch (error) {
        if (error.status === 404) {
          const allowAll = () => true;
          this.robotsCache.set(origin, allowAll);
          return true;
        }
        // If robots.txt is unreachable, do not crawl the page.
        this.robotsCache.set(origin, () => false);
        return false;
      }
      const rules = parseRobots(body);
      const check = (path) => isAllowed(rules, path);
      this.robotsCache.set(origin, check);
      return check(target.pathname);
    } catch {
      return false;
    }
  }
}

export function jsonFailure(text, { source, url } = {}) {
  if (/^\s*</.test(String(text || ''))) {
    const unavailable = /workday is currently unavailable/i.test(text)
      ? ' The site reports it is currently unavailable.'
      : ' It may be blocked, rate-limited, moved, or the URL may be wrong.';
    return new SourceError(`Source returned an HTML page instead of JSON.${unavailable}`, { source, url });
  }
  return new SourceError('Source returned invalid JSON.', { source, url });
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ type: key, path: value });
    }
  }
  return groups.filter((g) => g.agents.some((a) => a === '*' || a === 'jobscout'));
}

export function isAllowed(groups, path) {
  const matching = groups.filter((g) => g.agents.includes('*') || g.agents.some((a) => 'jobscout'.startsWith(a)));
  if (!matching.length) return true;
  const rules = matching.flatMap((g) => g.rules);
  if (!rules.length) return true;
  let best = null;
  for (const rule of rules) {
    if (rule.path === '/') {
      if (!best || rule.path.length > best.path.length) best = rule;
      continue;
    }
    if (path.startsWith(rule.path)) {
      if (!best || rule.path.length > best.path.length) best = rule;
    }
  }
  return !best || best.type === 'allow';
}

export function createHttp(logger) {
  return new HttpClient({ logger });
}
