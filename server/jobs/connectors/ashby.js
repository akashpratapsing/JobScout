import { finalizeSourceJobs, salaryTextFromRange, workModeHint, detectEmploymentType } from './common.js';

function labelFor(token) {
  return String(token).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export default {
  id: 'ashby',
  label: 'Ashby',
  method: 'Official public job board API',
  docsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
  notes: 'Public posting API for Ashby-hosted boards. No authentication required. Returns full descriptions and compensation when published.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.ashby || []).slice(0, ctx.maxBoards || 30);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const token of tokens) {
      try {
        const data = await ctx.http.json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`, {
          source: `Ashby/${token}`
        });
        const postings = Array.isArray(data.jobs) ? data.jobs : [];
        scanned += postings.length;
        const company = labelFor(token);
        for (const posting of postings) {
          if (posting.isListed === false) continue;
          const secondary = (posting.secondaryLocations || []).map((l) => l.location).filter(Boolean);
          const location = [posting.location, ...secondary].filter(Boolean).join(' / ');
          const compensation = posting.compensation?.compensationTierSummary
            || posting.compensation?.summary
            || salaryTextFromRange(posting.compensation?.summaryComponents?.[0]);
          jobs.push({
            source: 'ashby',
            sourceLabel: 'Ashby',
            board: token,
            title: posting.title,
            company,
            location,
            url: posting.jobUrl,
            requisitionId: posting.id,
            postedAt: posting.publishedAt,
            description: posting.descriptionHtml || posting.descriptionPlain || '',
            workModeHint: workModeHint(posting.workplaceType || (posting.isRemote ? 'remote' : '')),
            salaryText: compensation || '',
            employmentType: detectEmploymentType(posting.employmentType),
            tags: [posting.department, posting.team, posting.employmentType].filter(Boolean),
            sourceId: `ashby:${token}:${posting.id}`,
            sourceMeta: { board: token, ashbyId: posting.id }
          });
        }
      } catch (error) {
        warnings.push({ source: 'ashby', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings, scanned);
  }
};
