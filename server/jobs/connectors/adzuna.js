import { finalizeSourceJobs, detectEmploymentType } from './common.js';

const COUNTRY_PATHS = {
  in: 'in', us: 'us', gb: 'gb', ca: 'ca', au: 'au', de: 'de', fr: 'fr', nl: 'nl',
  sg: 'sg', ae: 'ae', nz: 'nz', ie: 'ie', es: 'es', it: 'it', pl: 'pl', br: 'br',
  mx: 'mx', za: 'za', ch: 'ch', at: 'at', be: 'be', dk: 'dk', no: 'no', se: 'se'
};

export default {
  id: 'adzuna',
  label: 'Adzuna',
  method: 'Official search API (free key required)',
  docsUrl: 'https://developer.adzuna.com/',
  notes: 'Optional. Requires a free Adzuna app ID and key. Good India + international coverage. JobScout never upgrades or bills an Adzuna account; if the free quota is exhausted, the source is reported as failed and other sources continue.',
  async fetchJobs(ctx) {
    const config = ctx.preferences.adzuna || {};
    if (!config.appId || !config.appKey) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'adzuna', message: 'Adzuna is enabled but no app ID/key is configured in Preferences.' }] };
    }
    const country = COUNTRY_PATHS[String(config.country || 'in').toLowerCase()] || 'in';
    const titles = (ctx.titles || []).slice(0, 3);
    const queries = titles.length ? titles : ['software engineer'];
    const where = (ctx.preferences.locations || [])[0] || '';
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const what of queries) {
      try {
        const params = new URLSearchParams({
          app_id: config.appId,
          app_key: config.appKey,
          results_per_page: '50',
          what,
          max_days_old: String(ctx.preferences.maxAgeDays || 60),
          content_type: 'application/json'
        });
        if (where) params.set('where', where);
        const data = await ctx.http.json(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`, {
          source: 'Adzuna'
        });
        const results = Array.isArray(data.results) ? data.results : [];
        scanned += results.length;
        for (const posting of results) {
          jobs.push({
            source: 'adzuna',
            sourceLabel: 'Adzuna',
            title: posting.title,
            company: posting.company?.display_name || 'Unknown company',
            location: posting.location?.display_name || where || country.toUpperCase(),
            url: posting.redirect_url,
            requisitionId: posting.id,
            postedAt: posting.created,
            description: posting.description || '',
            salaryText: posting.salary_min && posting.salary_max ? `${posting.salary_min}–${posting.salary_max}` : '',
            employmentType: detectEmploymentType(posting.contract_time),
            tags: [posting.category?.label].filter(Boolean),
            sourceId: `adzuna:${posting.id}`,
            sourceMeta: { adzunaId: posting.id, country }
          });
        }
      } catch (error) {
        warnings.push({ source: 'adzuna', message: error.message });
        if (error.status === 401 || error.status === 403) break;
      }
    }
    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
  }
};
