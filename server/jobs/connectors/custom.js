import { finalizeSourceJobs, detectEmploymentType } from './common.js';
import { canonicalUrl, hashText, oneLine, parseDate } from '../../lib/util.js';

function flattenGraph(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenGraph(item, out);
    return out;
  }
  if (typeof value === 'object') {
    if (value['@graph']) flattenGraph(value['@graph'], out);
    const type = value['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => String(t).toLowerCase() === 'jobposting')) out.push(value);
  }
  return out;
}

function extractJsonLd(html) {
  const values = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      values.push(...flattenGraph(parsed));
    } catch {
      // Invalid JSON-LD is ignored; the source is reported as unparsed.
    }
  }
  return values;
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return textValue(value.name ?? value['@id'] ?? value.value ?? value.url);
  return '';
}

function resolveUrl(value, base) {
  const raw = textValue(value);
  if (!raw) return '';
  try {
    const resolved = new URL(raw, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
  } catch {
    return '';
  }
}

function addressText(location) {
  const list = Array.isArray(location) ? location : [location];
  return list.map((loc) => {
    const address = loc?.address || loc;
    if (!address) return '';
    if (typeof address === 'string') return address;
    const country = typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry;
    return [address.addressLocality, address.addressRegion, country].filter(Boolean).join(', ');
  }).filter(Boolean).join(' / ');
}

function salaryText(baseSalary) {
  if (!baseSalary) return '';
  const value = baseSalary.value || baseSalary;
  if (typeof value === 'number') return `${baseSalary.currency || ''} ${value}`.trim();
  if (typeof value === 'string') return value;
  const min = value.minValue ?? value.value;
  const max = value.maxValue;
  const currency = baseSalary.currency || value.currency || '';
  if (min == null && max == null) return '';
  return `${currency} ${min ?? ''}${max != null && max !== min ? `–${max}` : ''}${value.unitText ? ` / ${value.unitText}` : ''}`.trim();
}

export default {
  id: 'custom',
  label: 'Company career pages (JSON-LD)',
  method: 'Schema.org JobPosting JSON-LD',
  docsUrl: 'https://schema.org/JobPosting',
  notes: 'Fetches a specific career-page URL, checks robots.txt, and reads JobPosting JSON-LD only. It does not scrape arbitrary HTML, bypass logins, or ignore access controls. Add one URL per company career page.',
  async fetchJobs(ctx) {
    const urls = (ctx.preferences.boards?.custom || []).slice(0, 20);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const rawUrl of urls) {
      let url;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol');
        url = parsed.toString();
      } catch {
        warnings.push({ source: 'custom', message: `Invalid career page URL: ${rawUrl}` });
        continue;
      }
      try {
        const allowed = await ctx.http.robotsAllowed(url);
        if (!allowed) {
          warnings.push({ source: 'custom', url, message: 'Blocked by robots.txt; page was not fetched.' });
          continue;
        }
        const html = await ctx.http.text(url, { source: 'Company career page', accept: 'text/html,application/xhtml+xml' });
        const postings = extractJsonLd(html);
        scanned += postings.length;
        if (!postings.length) {
          warnings.push({ source: 'custom', url, message: 'No JobPosting JSON-LD found. The page was not scraped.' });
          continue;
        }
        const host = new URL(url).host.replace(/^www\./, '');
        for (const posting of postings) {
          const title = textValue(posting.title);
          if (!title) continue;
          const validThrough = parseDate(posting.validThrough);
          if (validThrough && new Date(validThrough).getTime() < Date.now()) continue;
          const company = textValue(posting.hiringOrganization) || host;
          const identifier = textValue(posting.identifier);
          // JobPosting.url may be a string, a relative path, or an object such
          // as {"@id": "..."}. Fall back to the career page if it cannot be
          // resolved so one malformed posting never fails the whole source.
          const postingUrl = resolveUrl(posting.url, url) || url;
          const remote = /^telecommute$/i.test(textValue(posting.jobLocationType))
            || /remote|telecommute/i.test(JSON.stringify(posting.applicantLocationRequirements || ''));
          jobs.push({
            source: 'custom',
            sourceLabel: host,
            board: host,
            title,
            company,
            location: addressText(posting.jobLocation) || (remote ? 'Remote' : ''),
            url: postingUrl,
            requisitionId: identifier,
            postedAt: posting.datePosted,
            description: posting.description || '',
            workModeHint: remote ? 'remote' : '',
            remote,
            salaryText: salaryText(posting.baseSalary),
            employmentType: detectEmploymentType(Array.isArray(posting.employmentType) ? posting.employmentType.join(', ') : posting.employmentType),
            tags: [posting.occupationalCategory, posting.industry].map(textValue).filter(Boolean),
            sourceId: `custom:${host}:${identifier || hashText(canonicalUrl(postingUrl) + title)}`,
            sourceMeta: { pageUrl: url, validThrough }
          });
        }
      } catch (error) {
        warnings.push({ source: 'custom', url, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings, scanned);
  }
};
