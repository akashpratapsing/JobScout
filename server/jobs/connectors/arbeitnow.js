import { finalizeSourceJobs, detectEmploymentType } from './common.js';

export default {
  id: 'arbeitnow',
  label: 'Arbeitnow',
  method: 'Official public job board API',
  docsUrl: 'https://www.arbeitnow.com/api/job-board-api',
  notes: 'Public job board API with strong European coverage. Filters by your locations and remote preference; mostly Germany-based roles.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const data = await ctx.http.json('https://www.arbeitnow.com/api/job-board-api', { source: 'Arbeitnow' });
      const postings = Array.isArray(data.data) ? data.data : [];
      const jobs = postings.map((posting) => ({
        source: 'arbeitnow',
        sourceLabel: 'Arbeitnow',
        title: posting.title,
        company: posting.company_name,
        location: posting.location || 'Germany',
        url: posting.url,
        requisitionId: posting.slug,
        postedAt: posting.created_at,
        description: posting.description || '',
        workModeHint: posting.remote ? 'remote' : '',
        remote: Boolean(posting.remote),
        employmentType: detectEmploymentType((posting.job_types || []).join(', ')),
        tags: posting.tags || [],
        sourceId: `arbeitnow:${posting.slug}`,
        sourceMeta: { slug: posting.slug }
      }));
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'arbeitnow', message: error.message }] };
    }
  }
};
