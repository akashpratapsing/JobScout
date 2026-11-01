import { finalizeSourceJobs } from './common.js';

export default {
  id: 'remoteok',
  label: 'Remote OK',
  method: 'Official public JSON feed',
  docsUrl: 'https://remoteok.com/api',
  notes: 'Public API. Remote-only roles. Remote OK asks consumers to link back to the original posting; JobScout preserves and displays the source URL.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const data = await ctx.http.json('https://remoteok.com/api', { source: 'Remote OK' });
      const postings = Array.isArray(data) ? data.filter((j) => j && j.id && j.position) : [];
      const jobs = postings.map((posting) => ({
        source: 'remoteok',
        sourceLabel: 'Remote OK',
        title: posting.position,
        company: posting.company,
        location: posting.location || 'Remote',
        url: posting.url || posting.apply_url,
        requisitionId: posting.id,
        postedAt: posting.date || posting.epoch,
        description: posting.description || '',
        workModeHint: 'remote',
        remote: true,
        salaryText: posting.salary_min && posting.salary_max ? `$${posting.salary_min}–$${posting.salary_max}` : '',
        employmentType: posting.job_type || '',
        tags: posting.tags || [],
        attribution: 'Listing data from the Remote OK public API. Original posting link preserved.',
        sourceId: `remoteok:${posting.id}`,
        sourceMeta: { remoteokId: posting.id }
      }));
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'remoteok', message: error.message }] };
    }
  }
};
