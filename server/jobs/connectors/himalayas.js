import { finalizeSourceJobs, detectEmploymentType } from './common.js';
import { oneLine } from '../../lib/util.js';

export default {
  id: 'himalayas',
  label: 'Himalayas',
  method: 'Official public jobs API',
  docsUrl: 'https://himalayas.app/jobs/api',
  notes: 'Public remote-job feed with location restrictions and salary data. Remote-only roles.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const data = await ctx.http.json('https://himalayas.app/jobs/api?limit=100', { source: 'Himalayas' });
      const postings = Array.isArray(data.jobs) ? data.jobs : [];
      const jobs = postings.map((posting) => {
        const restrictions = Array.isArray(posting.locationRestrictions) ? posting.locationRestrictions : [];
        const salary = posting.minSalary || posting.maxSalary
          ? `${posting.currency || ''} ${posting.minSalary ?? ''}${posting.maxSalary ? `–${posting.maxSalary}` : ''}${posting.salaryPeriod ? ` / ${posting.salaryPeriod}` : ''}`.trim()
          : '';
        return {
          source: 'himalayas',
          sourceLabel: 'Himalayas',
          title: posting.title,
          company: posting.companyName,
          location: restrictions.length ? restrictions.join(', ') : 'Remote',
          url: posting.applicationLink || posting.guid,
          requisitionId: posting.guid || '',
          postedAt: posting.pubDate,
          description: posting.description || posting.excerpt || '',
          workModeHint: 'remote',
          remote: true,
          salaryText: salary,
          employmentType: detectEmploymentType(posting.employmentType),
          experienceRequired: (posting.seniority || []).join(', '),
          tags: [...(posting.categories || []), ...(posting.parentCategories || [])].filter(Boolean),
          sourceId: `himalayas:${posting.guid || posting.applicationLink}`,
          sourceMeta: { guid: posting.guid }
        };
      });
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'himalayas', message: error.message }] };
    }
  }
};
