import { finalizeSourceJobs, detectEmploymentType, workModeHint } from './common.js';
import { parseDate } from '../../lib/util.js';

function boardHost(board) {
  return board.host || `${board.tenant}.${board.wd || 'wd1'}.myworkdayjobs.com`;
}

function boardBase(board) {
  return `https://${boardHost(board)}/wday/cxs/${encodeURIComponent(board.tenant)}/${encodeURIComponent(board.site)}`;
}

function publicUrl(board, externalPath, externalUrl) {
  const fallback = `https://${boardHost(board)}/en-US/${encodeURIComponent(board.site)}${externalPath || ''}`;
  if (!externalUrl) return fallback;
  try {
    const resolved = new URL(String(externalUrl), `https://${boardHost(board)}/`);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : fallback;
  } catch {
    return fallback;
  }
}

export default {
  id: 'workday',
  label: 'Workday',
  method: 'Public career-site JSON endpoint (CXS)',
  docsUrl: 'https://community.workday.com/',
  notes: 'Uses the same public JSON endpoint that Workday career sites call. Each employer has its own tenant/site; add boards in Preferences. Workday does not provide a global search API.',
  async fetchJobs(ctx) {
    const boards = (ctx.preferences.boards?.workday || []).slice(0, ctx.maxBoards || 20);
    const jobs = [];
    const warnings = [];
    let scanned = 0;
    const perBoard = Math.min(ctx.perBoard || 4, 6);
    const titles = (ctx.titles || []).filter(Boolean).slice(0, 2);
    const queries = titles.length ? titles : ['software engineer'];

    for (const board of boards) {
      if (!board?.tenant || !board?.site) continue;
      const base = boardBase(board);
      const found = new Map();
      for (const searchText of queries) {
        try {
          const data = await ctx.http.json(`${base}/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: { appliedFacets: {}, limit: 20, offset: 0, searchText },
            source: `Workday/${board.tenant}`
          });
          const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];
          scanned += postings.length;
          for (const posting of postings) {
            if (!posting.externalPath || found.has(posting.externalPath)) continue;
            found.set(posting.externalPath, posting);
          }
        } catch (error) {
          warnings.push({ source: 'workday', board: board.tenant, message: error.message });
        }
      }

      const company = board.label || board.tenant.replace(/\b\w/g, (c) => c.toUpperCase());
      const candidates = [...found.values()]
        .map((posting) => ({
          source: 'workday',
          sourceLabel: 'Workday',
          board: `${board.tenant}/${board.site}`,
          title: posting.title,
          company,
          location: posting.locationsText || '',
          url: publicUrl(board, posting.externalPath),
          requisitionId: posting.bulletFields?.[0] || posting.jobRequisitionId || '',
          postedAt: parseDate(posting.postedOn),
          description: '',
          workModeHint: workModeHint(posting.locationsText || ''),
          sourceId: `workday:${board.tenant}:${board.site}:${posting.bulletFields?.[0] || posting.externalPath}`,
          sourceMeta: { board, externalPath: posting.externalPath }
        }))
        .filter((job) => ctx.prefilter(job));

      const ranked = candidates
        .map((job) => ({ job, rank: ctx.rank(job) }))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, perBoard);

      for (const { job } of ranked) {
        try {
          const detail = await ctx.http.json(`${base}${job.sourceMeta.externalPath}`, {
            source: `Workday/${board.tenant}`
          });
          const info = detail.jobPostingInfo || {};
          job.description = info.jobDescription || '';
          job.location = [info.location, ...(info.additionalLocations || [])].filter(Boolean).join(' / ') || job.location;
          job.url = publicUrl(board, job.sourceMeta.externalPath, info.externalUrl);
          job.requisitionId = info.jobRequisitionId || job.requisitionId;
          job.postedAt = parseDate(info.startDate) || parseDate(info.postedOn) || job.postedAt;
          job.employmentType = detectEmploymentType(info.timeType);
          job.workModeHint = workModeHint(`${job.location} ${info.timeType || ''}`);
          job.sourceMeta = { ...job.sourceMeta, canApply: info.canApply !== false, endDate: info.endDate || null };
          if (info.canApply === false) {
            warnings.push({ source: 'workday', board: board.tenant, message: `Posting is no longer accepting applications: ${job.title}` });
            continue;
          }
          jobs.push(job);
        } catch (error) {
          warnings.push({ source: 'workday', board: board.tenant, message: `Could not fetch detail: ${error.message}` });
        }
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
