import { finalizeSourceJobs, detectEmploymentType } from './common.js';
import { parseRssItems } from '../rss.js';
import { hashText } from '../../lib/util.js';

export default {
  id: 'weworkremotely',
  label: 'We Work Remotely',
  method: 'Official public RSS feed',
  docsUrl: 'https://weworkremotely.com/remote-jobs.rss',
  notes: 'Public RSS feed. Remote-only roles. JobScout preserves the original WWR posting URL.',
  async fetchJobs(ctx) {
    const warnings = [];
    try {
      const xml = await ctx.http.text('https://weworkremotely.com/remote-jobs.rss', { source: 'We Work Remotely', accept: 'application/rss+xml, application/xml, text/xml' });
      const items = parseRssItems(xml);
      const jobs = items.map((item) => {
        const split = item.title.match(/^([^:]+):\s*(.+)$/);
        const company = split?.[1]?.trim() || 'Unknown company';
        const title = split?.[2]?.trim() || item.title;
        return {
          source: 'weworkremotely',
          sourceLabel: 'We Work Remotely',
          title,
          company,
          location: item.region || item.country || 'Remote',
          url: item.link,
          requisitionId: '',
          postedAt: item.pubDate,
          description: item.description || '',
          workModeHint: 'remote',
          remote: true,
          employmentType: detectEmploymentType(item.type),
          tags: [item.category, item.skills].filter(Boolean),
          sourceId: `weworkremotely:${hashText(item.link)}`,
          sourceMeta: { link: item.link }
        };
      });
      return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 60, warnings);
    } catch (error) {
      return { jobs: [], scanned: 0, warnings: [{ source: 'weworkremotely', message: error.message }] };
    }
  }
};
