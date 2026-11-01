import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractResumeText,
  heuristicProfile,
  normalizeProfileInput,
  summarizeProfileForAi,
  profileCompleteness
} from '../server/resume.js';

const pdfBuffer = fs.readFileSync(new URL('./fixtures/sample-resume.pdf', import.meta.url));
const docxBuffer = fs.readFileSync(new URL('./fixtures/sample-resume.docx', import.meta.url));

function assertSampleProfile(profile, filename) {
  assert.equal(profile.name, 'Aarav Sharma');
  assert.equal(profile.email, 'aarav.sharma@example.com');
  assert.match(profile.phone, /98765/);
  assert.match(profile.location, /Bengaluru/i);
  assert.equal(profile.experienceYears, 5);
  assert.equal(profile.experienceLevel, 'senior');
  assert.equal(profile.headline, 'Senior Backend Engineer');
  assert.ok(profile.skills.includes('Python'));
  assert.ok(profile.skills.includes('AWS'));
  assert.ok(profile.skills.includes('Kubernetes'));
  assert.ok(profile.experience.length >= 2);
  assert.equal(profile.experience[0].title, 'Senior Backend Engineer');
  assert.equal(profile.experience[0].company, 'Nimbus Labs');
  assert.ok(profile.projects.length >= 2);
  assert.ok(profile.education.some((entry) => /National Institute of Technology/i.test(entry.institution)));
  assert.ok(profile.certifications.some((entry) => /AWS Certified/i.test(entry)));
  assert.match(profile.links.linkedin, /linkedin\.com\/in\/aaravsharma/i);
  assert.match(profile.links.github, /github\.com\/aaravsharma/i);
  assert.ok(profile.suggestedTitles.includes('Senior Backend Engineer'));
  assert.equal(profile.resumeFileName, filename);
  assert.equal(profile.analysis.method, 'heuristic');
  assert.ok(profile.rawText.length > 800);
}

test('extracts and parses the PDF resume', async () => {
  const text = await extractResumeText(pdfBuffer, 'sample-resume.pdf');
  assert.match(text, /Aarav Sharma/);
  assert.match(text, /Python/);
  assert.ok(text.length > 800);
  assertSampleProfile(heuristicProfile(text, 'sample-resume.pdf'), 'sample-resume.pdf');
});

test('extracts and parses the DOCX resume', async () => {
  const text = await extractResumeText(docxBuffer, 'sample-resume.docx');
  assert.match(text, /Aarav Sharma/);
  assert.match(text, /Kubernetes/);
  assert.ok(text.length > 800);
  assertSampleProfile(heuristicProfile(text, 'sample-resume.docx'), 'sample-resume.docx');
});

test('rejects empty and unsupported uploads', async () => {
  await assert.rejects(() => extractResumeText(Buffer.alloc(0), 'resume.pdf'), /empty/i);
  await assert.rejects(() => extractResumeText(Buffer.from('hello'), 'resume.rtf'), /unsupported/i);
});

test('plain text resumes are accepted for local testing', async () => {
  const text = await extractResumeText(
    Buffer.from('Jane Doe\njane@example.com\n\nSkills\nPython, SQL\n'),
    'resume.txt'
  );
  assert.match(text, /Jane Doe/);
});

test('normalizeProfileInput trims, canonicalizes and clamps user edits', () => {
  const profile = normalizeProfileInput({
    name: '  Aarav Sharma  ',
    skills: ['python', 'amazon web services', 'python', 'Kubernetes'],
    experienceYears: '150',
    experience: [{
      title: 'Engineer',
      company: 'Acme',
      start: '2020',
      end: 'Present',
      description: 'Built things',
      technologies: ['aws', 'docker'],
      extra: 'dropped'
    }],
    projects: [{ name: 'P', description: 'D', technologies: 'Python, AWS' }],
    education: [{ degree: 'B.Tech', institution: 'NIT', year: '2019', field: '' }],
    certifications: 'AWS Certified, CKA',
    keywords: 'backend, python',
    suggestedTitles: ['Backend Engineer'],
    links: { linkedin: 'https://linkedin.com/in/x', github: 'https://github.com/x', other: 'https://x.dev' },
    unknownField: 'ignored'
  });

  assert.equal(profile.name, 'Aarav Sharma');
  assert.equal(profile.experienceYears, 60);
  assert.deepEqual(profile.skills.slice(0, 2), ['Python', 'AWS']);
  assert.equal(profile.experience[0].technologies[0], 'AWS');
  assert.equal(profile.experience[0].extra, undefined);
  assert.deepEqual(profile.projects[0].technologies, ['Python', 'AWS']);
  assert.deepEqual(profile.certifications, ['AWS Certified', 'CKA']);
  assert.deepEqual(profile.keywords, ['backend', 'python']);
  assert.deepEqual(profile.links.other, ['https://x.dev']);
  assert.equal(profile.unknownField, undefined);
});

test('AI summary minimizes the resume payload', () => {
  const profile = heuristicProfile(
    'Aarav Sharma\nBengaluru, India\naarav@example.com\n\nSummary\nBackend engineer with 5 years of experience.\n\nSkills\nPython, AWS, Docker\n\nExperience\nSenior Engineer | Acme | Jan 2020 - Present\n' + 'Built services with Python and AWS. '.repeat(80),
    'resume.txt'
  );
  const summary = summarizeProfileForAi(profile);
  assert.equal(summary.rawText, undefined);
  assert.equal(summary.name, 'Aarav Sharma');
  assert.ok(summary.skills.includes('Python'));
  assert.ok(summary.experience[0].description.length <= 351);
});

test('profileCompleteness reflects the important fields', () => {
  assert.equal(profileCompleteness(null), 0);
  assert.equal(profileCompleteness({}), 0);
  const complete = profileCompleteness({
    name: 'A',
    email: 'a@b.c',
    location: 'Bengaluru',
    skills: ['Python', 'AWS', 'Docker'],
    experienceYears: 5,
    experience: [],
    education: [{ degree: 'B.Tech' }],
    projects: [{ name: 'P' }],
    suggestedTitles: ['Engineer']
  });
  assert.equal(complete, 100);
});
