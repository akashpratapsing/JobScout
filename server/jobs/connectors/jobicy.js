import { finalizeSourceJobs, detectEmploymentType } from './common.js';

export default {
  id: 'jobicy',
  label: 'Jobicy',
  method: 'Official public remote jobs API',
  docsUrl: 'https://jobicy.com/api/v2/remote-jobs',
  notes: 'Public remote-job API. Remote-only roles; Jobicy asks consumers to credit the source, which the UI does.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const data = await ctx.http.json('https://jobicy.com/api/v2/remote-jobs?count=50', { source: 'Jobicy' });
      const postings = Array.isArray(data.jobs) ? data.jobs : [];
      const jobs = postings.map((posting) => ({
        source: 'jobicy',
        sourceLabel: 'Jobicy',
        title: posting.jobTitle,
        company: posting.companyName,
        location: posting.jobGeo || 'Remote',
        url: posting.url,
        requisitionId: posting.id,
        postedAt: posting.pubDate,
        description: posting.jobDescription || posting.jobExcerpt || '',
        workModeHint: 'remote',
        remote: true,
        employmentType: detectEmploymentType((posting.jobType || []).join(', ')),
        experienceRequired: posting.jobLevel || '',
        tags: posting.jobIndustry || [],
        attribution: 'Listing data from the Jobicy public API.',
        sourceId: `jobicy:${posting.id}`,
        sourceMeta: { jobicyId: posting.id }
      }));
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'jobicy', message: error.message }] };
    }
  }
};
