import { finalizeSourceJobs, detectEmploymentType } from './common.js';

function salaryText(salary) {
  if (!salary || (salary.min == null && salary.max == null)) return '';
  const currency = salary.currency || '';
  const period = salary.period ? ` / ${salary.period}` : '';
  if (salary.min != null && salary.max != null && salary.min !== salary.max) return `${currency} ${salary.min}–${salary.max}${period}`.trim();
  return `${currency} ${salary.min ?? salary.max}${period}`.trim();
}

export default {
  id: 'recruitee',
  label: 'Recruitee',
  method: 'Public Recruitee offers API',
  docsUrl: 'https://docs.recruitee.com/reference/offers',
  notes: 'Public offers API for Recruitee-hosted career sites. No authentication required for public offers.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.recruitee || []).slice(0, ctx.maxBoards || 30);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const token of tokens) {
      try {
        const data = await ctx.http.json(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`, {
          source: `Recruitee/${token}`
        });
        const postings = Array.isArray(data.offers) ? data.offers : [];
        scanned += postings.length;
        const company = data.company_name || token;
        for (const posting of postings) {
          jobs.push({
            source: 'recruitee',
            sourceLabel: 'Recruitee',
            board: token,
            title: posting.title,
            company: company.replace(/\b\w/g, (c) => c.toUpperCase()),
            location: posting.location || [posting.city, posting.country].filter(Boolean).join(', '),
            url: posting.careers_url || `https://${token}.recruitee.com/o/${posting.slug}`,
            requisitionId: posting.id,
            postedAt: posting.published_at,
            description: [posting.description || '', posting.requirements || ''].join('\n'),
            workModeHint: posting.remote ? 'remote' : posting.hybrid ? 'hybrid' : posting.on_site ? 'onsite' : '',
            salaryText: salaryText(posting.salary),
            employmentType: detectEmploymentType(posting.employment_type_code),
            experienceRequired: posting.experience_code || '',
            tags: posting.tags || [],
            sourceId: `recruitee:${token}:${posting.id}`,
            sourceMeta: { board: token, recruiteeId: posting.id }
          });
        }
      } catch (error) {
        warnings.push({ source: 'recruitee', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
