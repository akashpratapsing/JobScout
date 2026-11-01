import { finalizeSourceJobs, detectEmploymentType, workModeHint } from './common.js';

function labelFor(token) {
  return String(token).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export default {
  id: 'workable',
  label: 'Workable',
  method: 'Public Workable widget API',
  docsUrl: 'https://workable.readme.io/reference/jobs',
  notes: 'Public widget endpoint for Workable-hosted boards. Some accounts return an empty jobs array even when the board is live; that is reported as a source warning, not hidden.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.workable || []).slice(0, ctx.maxBoards || 30);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const token of tokens) {
      try {
        const data = await ctx.http.json(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`, {
          source: `Workable/${token}`
        });
        const postings = Array.isArray(data.jobs) ? data.jobs : [];
        scanned += postings.length;
        if (!postings.length) {
          warnings.push({ source: 'workable', board: token, message: 'Workable returned 0 jobs for this board (board may be inactive or restricted).' });
        }
        const company = data.name || labelFor(token);
        for (const posting of postings) {
          const location = posting.locations?.length
            ? posting.locations.map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')).join(' / ')
            : [posting.city, posting.state, posting.country].filter(Boolean).join(', ');
          jobs.push({
            source: 'workable',
            sourceLabel: 'Workable',
            board: token,
            title: posting.title,
            company,
            location,
            url: posting.url || posting.shortlink,
            requisitionId: posting.shortcode || posting.code || posting.id,
            postedAt: posting.published_on || posting.created_at,
            description: [posting.description || '', posting.requirements || ''].join('\n'),
            workModeHint: posting.telecommuting ? 'remote' : workModeHint(posting.location || ''),
            employmentType: detectEmploymentType(posting.employment_type),
            experienceRequired: posting.experience || '',
            tags: [posting.department, posting.function, posting.industry].filter(Boolean),
            sourceId: `workable:${token}:${posting.shortcode || posting.id}`,
            sourceMeta: { board: token, shortcode: posting.shortcode || posting.id }
          });
        }
      } catch (error) {
        warnings.push({ source: 'workable', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
