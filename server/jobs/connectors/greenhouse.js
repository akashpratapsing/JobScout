import { finalizeSourceJobs, salaryTextFromRange, workModeHint, detectEmploymentType } from './common.js';

function labelFor(token) {
  return String(token)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function metadataValue(job, names) {
  const metadata = Array.isArray(job.metadata) ? job.metadata : [];
  for (const item of metadata) {
    const name = String(item.name || '').toLowerCase();
    if (names.some((n) => name.includes(n)) && item.value) return String(item.value);
  }
  return '';
}

export default {
  id: 'greenhouse',
  label: 'Greenhouse',
  method: 'Official public job board API',
  docsUrl: 'https://developers.greenhouse.io/job-board.html',
  notes: 'Public board API. Works only for companies that publish a Greenhouse job board. No authentication required.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.greenhouse || []).slice(0, ctx.maxBoards || 30);
    const jobs = [];
    const warnings = [];
    let scanned = 0;
    const perBoard = Math.min(ctx.perBoard || 6, 10);

    for (const token of tokens) {
      try {
        const list = await ctx.http.json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=false`, {
          source: `Greenhouse/${token}`
        });
        const rawList = Array.isArray(list.jobs) ? list.jobs : [];
        scanned += rawList.length;
        const company = labelFor(token);
        const candidates = rawList
          .map((job) => ({
            source: 'greenhouse',
            sourceLabel: 'Greenhouse',
            board: token,
            title: job.title,
            company,
            location: job.location?.name || '',
            url: job.absolute_url,
            requisitionId: job.requisition_id || job.internal_job_id || job.id,
            postedAt: job.first_published || job.updated_at,
            description: '',
            workModeHint: workModeHint(job.location?.name || ''),
            salaryText: metadataValue(job, ['salary', 'compensation', 'pay range']),
            employmentType: metadataValue(job, ['employment type', 'type']),
            sourceId: `greenhouse:${token}:${job.id}`,
            sourceMeta: { board: token, greenhouseId: job.id }
          }))
          .filter((job) => ctx.prefilter(job));
        const ranked = candidates
          .map((job) => ({ job, rank: ctx.rank(job) }))
          .sort((a, b) => b.rank - a.rank)
          .slice(0, perBoard);

        for (const { job } of ranked) {
          try {
            const detail = await ctx.http.json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${job.sourceMeta.greenhouseId}`, {
              source: `Greenhouse/${token}`
            });
            job.description = detail.content || '';
            job.location = detail.location?.name || job.location;
            job.postedAt = job.postedAt || detail.first_published;
            job.requisitionId = detail.requisition_id || job.requisitionId;
            job.salaryText = job.salaryText || metadataValue(detail, ['salary', 'compensation', 'pay range']);
            job.employmentType = job.employmentType || metadataValue(detail, ['employment type', 'type']);
            jobs.push(job);
          } catch (error) {
            warnings.push({ source: 'greenhouse', board: token, message: `Could not fetch job detail: ${error.message}` });
          }
        }
      } catch (error) {
        warnings.push({ source: 'greenhouse', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
