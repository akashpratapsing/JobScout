const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', agrave: 'à', uuml: 'ü',
  ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', euro: '€', pound: '£',
  yen: '¥', cent: '¢', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½'
};

export function decodeEntities(input = '') {
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripHtml(input = '') {
  if (!input) return '';
  let text = String(input)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return normalizeWhitespace(text);
}

export function normalizeWhitespace(input = '') {
  return String(input)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function oneLine(input = '', max = 400) {
  const text = normalizeWhitespace(input).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function uniqueStrings(values = [], { lower = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = lower ? text.toLowerCase() : text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDate(value, now = new Date()) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = String(value).trim();
  if (/^\d{10}$/.test(text)) return parseDate(Number(text), now);
  if (/^\d{13}$/.test(text)) return parseDate(Number(text), now);

  const relative = text.match(/posted\s+(today|yesterday|(\d+)\+?\s+days?\s+ago)/i);
  if (relative) {
    const date = new Date(now);
    if (relative[1].toLowerCase() === 'today') return date.toISOString();
    if (relative[1].toLowerCase() === 'yesterday') {
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString();
    }
    date.setUTCDate(date.getUTCDate() - Number(relative[2]));
    return date.toISOString();
  }
  if (/^(today|just posted)$/i.test(text)) return now.toISOString();
  if (/^yesterday$/i.test(text)) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString();
  }

  let normalized = text;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) normalized = normalized.replace(' ', 'T') + 'Z';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() < 1990 || date.getFullYear() > now.getFullYear() + 2) return null;
  return date.toISOString();
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 86400000));
}

export function canonicalUrl(raw) {
  if (!raw) return '';
  try {
    const url = new URL(String(raw));
    url.hash = '';
    const drop = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'gh_src', 'lever-source', 'source', 'ref', 'referrer', 'fbclid', 'gclid', 'mc_cid',
      'mc_eid', 'trk', 'trackingid', 'src', 'campaign', 'utm', 'jobboard', 'job_board'
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (drop.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    url.searchParams.sort();
    return url.toString();
  } catch {
    return String(raw).trim();
  }
}

export function tokenSet(text = '') {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s-]/g, ' ')
      .split(/[\s/|,;()\[\]{}]+/)
      .map((t) => t.replace(/^[-.]+|[-.]+$/g, ''))
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'you', 'your', 'our', 'are', 'will',
  'have', 'has', 'had', 'not', 'but', 'all', 'any', 'can', 'may', 'who', 'how', 'what',
  'job', 'role', 'work', 'team', 'company', 'about', 'into', 'their', 'they', 'them', 'its',
  'a', 'an', 'of', 'to', 'in', 'on', 'at', 'as', 'by', 'or', 'is', 'be', 'we', 'it', 'if'
]);

export function jaccard(aText, bText) {
  const a = tokenSet(aText);
  const b = tokenSet(bText);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function titleSimilarity(a, b) {
  const normalize = (s) => String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(m\/f\/d|m\/w\/d|f\/m\/d|remote|hybrid|onsite|on-site)\b/g, ' ')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const a1 = normalize(a);
  const b1 = normalize(b);
  if (!a1 || !b1) return 0;
  if (a1 === b1) return 1;
  const aTokens = new Set(a1.split(' ').filter((t) => t.length > 1));
  const bTokens = new Set(b1.split(' ').filter((t) => t.length > 1));
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared += 1;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jac = union ? shared / union : 0;
  const containment = shared / Math.min(aTokens.size, bTokens.size);
  return Math.max(jac, containment * 0.92);
}

export function hashText(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

export function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj?.[key] != null) out[key] = obj[key];
  return out;
}
