import path from 'node:path';
import mammoth from 'mammoth';
import { detectSkills, canonicalSkills, suggestTitles } from './matching/skills.js';
import { inferCandidateLevel } from './matching/score.js';
import { normalizeWhitespace, uniqueStrings, oneLine } from './lib/util.js';

export async function extractResumeText(buffer, filename = '') {
  const ext = path.extname(filename).toLowerCase();
  const size = buffer?.length || 0;
  if (!size) throw new Error('The uploaded file is empty.');
  if (size > 10 * 1024 * 1024) throw new Error('Resume is larger than 10 MB.');

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return cleanResumeText(result.value);
  }
  if (ext === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true
    });
    const pages = [];
    try {
      const doc = await loadingTask.promise;
      const maxPages = Math.min(doc.numPages, 40);
      for (let i = 1; i <= maxPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          text += item.str;
          text += item.hasEOL ? '\n' : ' ';
        }
        pages.push(text);
        page.cleanup();
      }
    } finally {
      // pdf.js exposes destroy() on the loading task in current releases.
      await loadingTask.destroy?.();
    }
    const cleaned = cleanResumeText(pages.join('\n\n'));
    if (cleaned.replace(/\s/g, '').length < 80) {
      throw new Error('This PDF appears to be scanned or image-only. OCR is not enabled; upload a text-based PDF or DOCX.');
    }
    return cleaned;
  }
  if (ext === '.txt' || ext === '.md') {
    return cleanResumeText(buffer.toString('utf8'));
  }
  throw new Error('Unsupported file type. Upload a PDF or DOCX resume.');
}

function cleanResumeText(value) {
  return normalizeWhitespace(String(value || ''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const SECTION_HEADINGS = [
  ['summary', /^(summary|professional summary|profile|about me|objective|career objective|overview)\s*:?\s*$/i],
  ['experience', /^(experience|work experience|professional experience|employment(?: history)?|work history|career history)\s*:?\s*$/i],
  ['education', /^(education|academic background|academics|qualifications)\s*:?\s*$/i],
  ['skills', /^(skills|technical skills|core competencies|technologies|tech stack|expertise)\s*:?\s*$/i],
  ['projects', /^(projects|personal projects|selected projects|key projects|portfolio)\s*:?\s*$/i],
  ['certifications', /^(certifications?|licenses?|courses?|training)\s*:?\s*$/i],
  ['awards', /^(awards?|achievements?|honors?)\s*:?\s*$/i],
  ['languages', /^(languages?)\s*:?\s*$/i]
];

export function splitResumeSections(text) {
  const lines = normalizeWhitespace(text || '').split('\n');
  const sections = { header: [] };
  let current = 'header';
  for (const line of lines) {
    const clean = line.replace(/^[#*\-•\s]+/, '').replace(/[:]+$/, '').trim();
    const found = SECTION_HEADINGS.find(([, re]) => re.test(clean));
    if (found) {
      current = found[0];
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.join('\n').trim()]));
}

export function heuristicProfile(text, filename = '') {
  const rawText = cleanResumeText(text);
  const sections = splitResumeSections(rawText);
  const header = sections.header || '';
  const email = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || '';
  const phone = rawText.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,6}/)?.[0]?.trim() || '';
  const bareLinks = rawText.match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s)|,;]+/gi) || [];
  const links = uniqueStrings([
    ...(rawText.match(/https?:\/\/[^\s)]+/gi) || []),
    ...bareLinks.map((link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`))
  ].map((u) => u.replace(/[.,;]+$/, ''))).slice(0, 6);
  const linkedin = links.find((l) => /linkedin\.com/i.test(l)) || '';
  const github = links.find((l) => /github\.com/i.test(l)) || '';

  const lines = header.split('\n').map((l) => l.trim()).filter(Boolean);
  let name = lines.find((line) => {
    if (line.length < 3 || line.length > 60) return false;
    if (/@|https?:|linkedin|github|\d{4}/i.test(line)) return false;
    if (/^(resume|curriculum vitae|cv)$/i.test(line)) return false;
    return /^[A-Za-z][A-Za-z.'\-\s]+$/.test(line) && line.split(/\s+/).length <= 5;
  }) || '';
  name = name.replace(/\s{2,}/g, ' ').trim();

  const locationLine = header.split('\n').find((line) => /(?:location|based in|address)\s*[:|-]/i.test(line))
    || header.split('\n').find((line) => /\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|remote|united states|usa|uk|london|singapore|dubai|toronto|berlin)\b/i.test(line));
  const location = locationLine ? locationLine.replace(/^.*?(?:location|based in|address)\s*[:|-]\s*/i, '').replace(/\s*[|•].*$/, '').trim() : '';

  const skillHits = detectSkills(rawText).map((s) => s.name);
  const skillSection = sections.skills || '';
  const sectionSkills = skillSection
    .split(/[,|•\n;]/)
    .map((s) => s.replace(/^[-*\s]+/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const skills = canonicalSkills([...skillHits, ...sectionSkills]).slice(0, 60);

  const experienceYears = estimateExperienceYears(rawText, sections.experience || '');
  const experienceLevel = inferCandidateLevel(experienceYears);
  const experience = parseExperience(sections.experience || '');
  const projects = parseProjects(sections.projects || '');
  const education = parseEducation(sections.education || '', rawText);
  const certifications = parseCertifications(sections.certifications || '', rawText);
  const summary = oneLine(sections.summary || '', 600);
  const suggestedTitles = rankSuggestedTitles(suggestTitles(skills, experienceYears || 0), experience[0]?.title);
  const keywords = uniqueStrings([...skills, ...(sections.skills || '').split(/[,|•\n;]/).map((s) => s.trim())])
    .filter((k) => k.length >= 2 && k.length <= 45)
    .slice(0, 40);

  return {
    name,
    email,
    phone,
    location,
    headline: experience[0]?.title || suggestedTitles[0] || '',
    summary: summary || (experience[0] ? `${experience[0].title}${experience[0].company ? ` at ${experience[0].company}` : ''}.` : ''),
    skills,
    experienceYears,
    experienceLevel,
    experience,
    projects,
    education,
    certifications,
    keywords,
    suggestedTitles,
    links: { linkedin, github, other: links.filter((l) => l !== linkedin && l !== github) },
    resumeFileName: filename,
    resumeUploadedAt: new Date().toISOString(),
    rawText,
    analysis: {
      method: 'heuristic',
      at: new Date().toISOString(),
      note: 'Extracted locally without AI. Review and correct the fields below.'
    }
  };
}

function rankSuggestedTitles(titles, currentTitle) {
  const list = [...titles];
  const current = String(currentTitle || '').trim();
  if (!current) return list.slice(0, 12);
  const withoutCurrent = list.filter((title) => String(title).toLowerCase() !== current.toLowerCase());
  // Keep the candidate's actual current title at the front: it is the most
  // reliable search term, even when a de-seniored variant also exists.
  return [current, ...withoutCurrent].slice(0, 12);
}

export function estimateExperienceYears(text, experienceSection = '') {
  const explicit = String(text).match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:professional\s+|relevant\s+|industry\s+)?experience/i);
  if (explicit) {
    const value = Number(explicit[1]);
    if (value >= 0 && value <= 40) return value;
  }

  const source = `${experienceSection}\n${text}`;
  const ranges = [];
  const rangeRe = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.'-]*)?(19\d{2}|20\d{2})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.'-]*)?(19\d{2}|20\d{2}|present|current|now)/gi;
  let match;
  while ((match = rangeRe.exec(source)) !== null) {
    const startYear = Number(match[2]);
    const endYear = /present|current|now/i.test(match[4]) ? new Date().getFullYear() : Number(match[4]);
    if (endYear < startYear || startYear < 1980 || endYear > new Date().getFullYear() + 1) continue;
    const startMonth = monthFromText(match[1]);
    const endMonth = /present|current|now/i.test(match[4]) ? new Date().getMonth() : monthFromText(match[3]);
    const start = new Date(Date.UTC(startYear, startMonth, 1));
    const end = new Date(Date.UTC(endYear, endMonth + 1, 0));
    ranges.push([start.getTime(), end.getTime()]);
  }
  if (!ranges.length) return null;

  // Merge overlapping ranges so concurrent roles are not double-counted.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const months = merged.reduce((sum, [start, end]) => sum + Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30.44)), 0);
  return Math.round((months / 12) * 10) / 10;
}

function monthFromText(value = '') {
  const m = String(value).match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i);
  return m ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[0].toLowerCase().slice(0, 3)) : 0;
}

function parseExperience(section) {
  if (!section) return [];
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];
  let current = null;
  const dateRe = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.'-]*)?(19\d{2}|20\d{2})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.'-]*)?(19\d{2}|20\d{2}|present|current|now)/i;

  for (const line of lines) {
    const dateMatch = line.match(dateRe);
    if (dateMatch) {
      if (current) entries.push(current);
      const withoutDate = line.replace(dateRe, '').replace(/[|•,]+$/g, '').trim();
      const [maybeTitle, maybeCompany] = splitTitleCompany(withoutDate);
      current = {
        title: maybeTitle || '',
        company: maybeCompany || '',
        start: dateMatch[0].split(/\s*(?:-|–|—|to)\s*/i)[0]?.trim() || '',
        end: dateMatch[0].split(/\s*(?:-|–|—|to)\s*/i)[1]?.trim() || '',
        description: '',
        technologies: []
      };
    } else if (current) {
      const clean = line.replace(/^[-*•\s]+/, '').trim();
      if (!current.title && clean.length < 80) current.title = clean;
      else if (!current.company && clean.length < 80 && /(?:at|@)\s+/i.test(clean)) current.company = clean.replace(/^.*(?:at|@)\s+/i, '');
      else current.description = `${current.description}${current.description ? ' ' : ''}${clean}`.slice(0, 1500);
    }
  }
  if (current) entries.push(current);
  for (const entry of entries) {
    entry.technologies = detectSkills(`${entry.title} ${entry.description}`).map((s) => s.name).slice(0, 15);
    entry.description = oneLine(entry.description, 700);
  }
  return entries.filter((e) => e.title || e.company).slice(0, 10);
}

function splitTitleCompany(line) {
  if (!line) return ['', ''];
  const parts = line.split(/\s*(?:\||@| at | – | — |,)\s*/i).filter(Boolean);
  if (parts.length >= 2) return [parts[0].trim(), parts[1].trim()];
  return [line.trim(), ''];
}

function parseProjects(section) {
  if (!section) return [];
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
  const projects = [];
  let current = null;

  for (const raw of lines) {
    const isBullet = /^[-*•]\s+/.test(raw);
    const clean = raw.replace(/^[-*•\s]+/, '').trim();
    if (!clean) continue;
    // Project headings are normally the first line of a block or a line that
    // follows a description. Bullet items and ordinary prose are description
    // text, which keeps multi-line PDF and DOCX resumes from collapsing into a
    // single project.
    const looksLikeTitle = !isBullet && (!current || current.description || /[|–—:]| - /.test(clean));
    if (!current || looksLikeTitle) {
      if (current) projects.push(current);
      current = {
        name: clean.replace(/[|:]+$/, '').trim().slice(0, 120),
        description: '',
        technologies: []
      };
    } else {
      current.description = oneLine(`${current.description}${current.description ? ' ' : ''}${clean}`, 600);
    }
  }
  if (current) projects.push(current);
  for (const project of projects) {
    project.technologies = detectSkills(`${project.name} ${project.description}`).map((s) => s.name).slice(0, 15);
  }
  return projects.slice(0, 8);
}

function parseEducation(section, fullText) {
  const source = section || fullText;
  const lines = source.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (!/(bachelor|master|b\.?tech|b\.?e\.?\b|b\.?sc|m\.?sc|mba|ph\.?d|degree|university|college|institute|iit|nit|bits)/i.test(line)) continue;
    const year = line.match(/(19|20)\d{2}/)?.[0] || '';
    const degreeMatch = line.match(/(bachelor[^,|]*|master[^,|]*|b\.?tech[^,|]*|b\.?e\.?[^,|]*|b\.?sc[^,|]*|m\.?sc[^,|]*|mba[^,|]*|ph\.?d[^,|]*|degree[^,|]*)/i);
    const institutionPart = line.split(/\s*[|]\s*/).find((part) => /university|college|institute|iit|nit|bits/i.test(part))
      || line.split(/\s*[,]\s*/).find((part) => /university|college|institute|iit|nit|bits/i.test(part))
      || '';
    out.push({
      degree: (degreeMatch?.[0] || line).replace(/\s+/g, ' ').trim().slice(0, 120),
      institution: institutionPart.replace(/\s*[|,].*$/, '').trim().slice(0, 120),
      year,
      field: ''
    });
    if (out.length >= 6) break;
  }
  return out;
}

function parseCertifications(section, fullText) {
  const source = section || fullText;
  const lines = source.split('\n').map((l) => l.replace(/^[-*•\s]+/, '').trim()).filter(Boolean);
  const certs = lines.filter((line) => /(certified|certification|certificate|aws|azure|gcp|scrum|pmp|cissp|ccna|kubernetes|tensorflow|google cloud)/i.test(line) && line.length < 140);
  return uniqueStrings(certs).slice(0, 12);
}

export function normalizeProfileInput(input = {}) {
  const strings = (value) => uniqueStrings(Array.isArray(value) ? value : String(value || '').split(/\n|,/)).slice(0, 100);
  const text = (value, max) => String(value ?? '').trim().slice(0, max);
  const objects = (value, fields) => (Array.isArray(value) ? value : []).slice(0, 30).map((item) => {
    const out = {};
    for (const field of fields) {
      if (field === 'technologies') out[field] = canonicalSkills(strings(item?.[field]));
      else out[field] = text(item?.[field], 2000);
    }
    return out;
  });

  return {
    name: text(input.name, 120),
    email: text(input.email, 160),
    phone: text(input.phone, 60),
    location: text(input.location, 160),
    headline: text(input.headline, 180),
    summary: text(input.summary, 3000),
    skills: canonicalSkills(strings(input.skills)).slice(0, 80),
    experienceYears: input.experienceYears === '' || input.experienceYears == null ? null : Math.max(0, Math.min(60, Number(input.experienceYears) || 0)),
    experienceLevel: text(input.experienceLevel, 40),
    experience: objects(input.experience, ['title', 'company', 'start', 'end', 'description', 'technologies']),
    projects: objects(input.projects, ['name', 'description', 'technologies']),
    education: objects(input.education, ['degree', 'institution', 'year', 'field']),
    certifications: strings(input.certifications),
    keywords: strings(input.keywords).slice(0, 80),
    suggestedTitles: strings(input.suggestedTitles).slice(0, 12),
    links: {
      linkedin: text(input.links?.linkedin, 300),
      github: text(input.links?.github, 300),
      other: strings(input.links?.other).slice(0, 10)
    }
  };
}

export function profileCompleteness(profile) {
  if (!profile) return 0;
  const checks = [
    profile.name,
    profile.email || profile.phone,
    profile.location,
    profile.skills?.length >= 3,
    profile.experience?.length >= 1 || profile.experienceYears > 0,
    profile.education?.length >= 1,
    profile.projects?.length >= 1,
    profile.suggestedTitles?.length >= 1
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function summarizeProfileForAi(profile) {
  return {
    name: profile.name,
    headline: profile.headline,
    location: profile.location,
    experienceYears: profile.experienceYears,
    experienceLevel: profile.experienceLevel,
    skills: profile.skills,
    suggestedTitles: profile.suggestedTitles,
    experience: (profile.experience || []).slice(0, 6).map((e) => ({
      title: e.title,
      company: e.company,
      start: e.start,
      end: e.end,
      description: oneLine(e.description, 350),
      technologies: e.technologies
    })),
    projects: (profile.projects || []).slice(0, 5).map((p) => ({
      name: p.name,
      description: oneLine(p.description, 300),
      technologies: p.technologies
    })),
    education: (profile.education || []).slice(0, 3),
    certifications: (profile.certifications || []).slice(0, 8),
    keywords: (profile.keywords || []).slice(0, 30)
  };
}
