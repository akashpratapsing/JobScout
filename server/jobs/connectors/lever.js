import { finalizeSourceJobs, salaryTextFromRange, workModeHint, detectEmploymentType } from './common.js';

function labelFor(token) {
  return String(token).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export default {
  id: 'lever',
  label: 'Lever',
  method: 'Official public postings API',
  docsUrl: 'https://github.com/lever/postings-api',
  notes: 'Public JSON postings API. Works for companies with a public Lever board. No authentication required.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.lever || []).slice(0, ctx.maxBoards || 30);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const token of tokens) {
      try {
        const postings = await ctx.http.json(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`, {
          source: `Lever/${token}`
        });
        if (!Array.isArray(postings)) {
          warnings.push({ source: 'lever', board: token, message: 'Lever returned an unexpected response shape.' });
          continue;
        }
        scanned += postings.length;
        const company = labelFor(token);
        for (const posting of postings) {
          const description = [
            posting.descriptionPlain || posting.description || '',
            posting.additionalPlain || posting.additional || '',
            ...(posting.lists || []).map((l) => `${l.text || ''}\n${l.content || ''}`)
          ].join('\n');
          jobs.push({
            source: 'lever',
            sourceLabel: 'Lever',
            board: token,
            title: posting.text,
            company,
            location: posting.categories?.location || '',
            url: posting.hostedUrl,
            requisitionId: posting.id,
            postedAt: posting.createdAt,
            description,
            workModeHint: workModeHint(posting.workplaceType || posting.categories?.location || ''),
            salaryText: salaryTextFromRange(posting.salaryRange),
            employmentType: detectEmploymentType(posting.categories?.commitment),
            tags: [posting.categories?.team, posting.categories?.department, posting.categories?.commitment].filter(Boolean),
            sourceId: `lever:${token}:${posting.id}`,
            sourceMeta: { board: token, leverId: posting.id }
          });
        }
      } catch (error) {
        warnings.push({ source: 'lever', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
