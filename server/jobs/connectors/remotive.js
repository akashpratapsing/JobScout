import { finalizeSourceJobs, detectEmploymentType } from './common.js';

export default {
  id: 'remotive',
  label: 'Remotive',
  method: 'Official public API',
  docsUrl: 'https://remotive.com/api/remote-jobs',
  notes: 'Public remote-jobs API. Remote-only roles; JobScout links back to Remotive and the original posting.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const data = await ctx.http.json('https://remotive.com/api/remote-jobs?limit=200', { source: 'Remotive' });
      const postings = Array.isArray(data.jobs) ? data.jobs : [];
      const jobs = postings.map((posting) => ({
        source: 'remotive',
        sourceLabel: 'Remotive',
        title: posting.title,
        company: posting.company_name,
        location: posting.candidate_required_location || 'Remote',
        url: posting.url,
        requisitionId: posting.id,
        postedAt: posting.publication_date,
        description: posting.description || '',
        workModeHint: 'remote',
        remote: true,
        salaryText: posting.salary || '',
        employmentType: detectEmploymentType(posting.job_type),
        tags: [posting.category, ...(posting.tags || [])].filter(Boolean),
        sourceId: `remotive:${posting.id}`,
        sourceMeta: { remotiveId: posting.id }
      }));
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'remotive', message: error.message }] };
    }
  }
};
