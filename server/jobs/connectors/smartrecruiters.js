import { finalizeSourceJobs, detectEmploymentType } from './common.js';

function sectionText(section) {
  if (!section) return '';
  if (typeof section === 'string') return section;
  if (Array.isArray(section)) return section.map(sectionText).join('\n');
  if (typeof section === 'object') return section.text || section.content || '';
  return '';
}

function locationText(location) {
  if (!location) return '';
  if (typeof location === 'string') return location;
  return [location.city, location.region, location.country].filter(Boolean).join(', ');
}

export default {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  method: 'Public postings API (best effort)',
  docsUrl: 'https://developers.smartrecruiters.com/docs/partners',
  notes: 'The public postings endpoint is implemented, but tested tenants returned 0 postings in October 2026. Access appears restricted for some companies; JobScout reports this instead of inventing results. Add company identifiers in Preferences.',
  async fetchJobs(ctx) {
    const tokens = (ctx.preferences.boards?.smartrecruiters || []).slice(0, ctx.maxBoards || 20);
    const jobs = [];
    const warnings = [];
    let scanned = 0;

    for (const token of tokens) {
      try {
        const data = await ctx.http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=0`, {
          source: `SmartRecruiters/${token}`
        });
        const postings = Array.isArray(data.content) ? data.content : [];
        scanned += Number(data.totalFound) || postings.length;
        if (!postings.length) {
          warnings.push({ source: 'smartrecruiters', board: token, message: 'Public API returned 0 postings. The company may restrict its listing API.' });
        }
        const company = postings[0]?.company?.name || token;
        for (const posting of postings) {
          let detail = null;
          try {
            detail = await ctx.http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(posting.id)}`, {
              source: `SmartRecruiters/${token}`
            });
          } catch (error) {
            warnings.push({ source: 'smartrecruiters', board: token, message: `Detail unavailable for ${posting.id}: ${error.message}` });
          }
          const sections = detail?.jobAd?.sections || {};
          const description = [
            sectionText(sections.companyDescription),
            sectionText(sections.jobDescription),
            sectionText(sections.qualifications),
            sectionText(sections.additionalInformation)
          ].join('\n');
          const loc = locationText(detail?.location || posting.location);
          jobs.push({
            source: 'smartrecruiters',
            sourceLabel: 'SmartRecruiters',
            board: token,
            title: detail?.name || posting.name,
            company: detail?.company?.name || company,
            location: loc,
            url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(posting.id)}`,
            requisitionId: detail?.ref || posting.ref || posting.id,
            postedAt: detail?.releasedDate || posting.releasedDate,
            description,
            workModeHint: loc,
            employmentType: detectEmploymentType(detail?.typeOfEmployment?.label || posting.typeOfEmployment?.label),
            experienceRequired: detail?.experienceLevel?.label || posting.experienceLevel?.label || '',
            tags: [detail?.department?.label, detail?.function?.label, detail?.industry?.label].filter(Boolean),
            sourceId: `smartrecruiters:${token}:${posting.id}`,
            sourceMeta: { board: token, smartRecruitersId: posting.id }
          });
        }
      } catch (error) {
        warnings.push({ source: 'smartrecruiters', board: token, message: error.message });
      }
    }

    return finalizeSourceJobs(jobs, ctx, ctx.maxPerFeed || 80, warnings);
  }
};
