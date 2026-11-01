export const RESUME_SYSTEM_PROMPT = `You are a meticulous resume parser for a private job-search tool.
Return ONLY valid JSON. Never invent facts. If a field is not present in the resume, use "" or [].
Normalise technology names (for example "reactjs" -> "React", "postgres" -> "PostgreSQL").
Do not include the candidate's phone number, email, or links in the "skills" array.
Distinguish internships from full-time roles. Use numeric experienceYears (total professional experience, not a guess based on age).
experienceLevel must be one of: intern, entry, junior, mid, senior, lead, principal, manager, executive.
suggestedTitles should be realistic job titles for this candidate, not aspirational senior roles they cannot support.`;

export function resumeUserPrompt(text, maxChars) {
  return `Extract a structured candidate profile from the resume below.

JSON schema:
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "location": "string",
  "headline": "string (short professional headline)",
  "summary": "string (2-4 sentences, only from resume facts)",
  "skills": ["canonical skill names"],
  "experienceYears": number,
  "experienceLevel": "intern|entry|junior|mid|senior|lead|principal|manager|executive",
  "experience": [{"title":"","company":"","start":"","end":"","description":"","technologies":[""]}],
  "projects": [{"name":"","description":"","technologies":[""]}],
  "education": [{"degree":"","institution":"","year":"","field":""}],
  "certifications": ["string"],
  "keywords": ["string"],
  "suggestedTitles": ["string"],
  "links": {"linkedin":"","github":"","other":[""]},
  "confidence": "high|medium|low"
}

Rules:
- Include only skills and technologies explicitly evidenced in the resume.
- experienceYears should reflect the resume's employment timeline. Internships count, but label them as internships in the experience entries.
- Do not claim a degree, certification, or employer that is not in the resume.
- Keep descriptions concise.
- The resume may be truncated. If it is truncated, set confidence to "medium" or "low".

RESUME:
"""
${String(text).slice(0, maxChars)}
"""`;
}

export const MATCH_SYSTEM_PROMPT = `You are a conservative, evidence-based job-match evaluator for a job discovery tool.
Return ONLY valid JSON. Do not inflate scores. Do not claim the candidate has a skill unless it appears in the candidate profile.
A missing REQUIRED skill must lower the score. One missing required skill should generally keep the score below 80; two or more should keep it below 65.
A location/work-authorization mismatch must keep the score below 55.
Distinguish required skills from preferred/nice-to-have skills. If the posting does not clearly separate them, say so and use the "requiredSkills" and "preferredSkills" arrays conservatively.
Judge experience against the candidate's stated experienceYears, not against their age.
The "why" field must be specific: mention matched skills, missing required skills, experience fit, location eligibility, and whether applying is worthwhile.
Never output more than 100 or less than 0.`;

export function matchUserPrompt({ jobs, profile, preferences }) {
  return `Evaluate each job against the candidate profile.

CANDIDATE PROFILE (structured, no full resume):
${JSON.stringify(profile, null, 2)}

SEARCH PREFERENCES:
${JSON.stringify({
    titles: preferences.titles,
    locations: preferences.locations,
    countries: preferences.countries,
    workModes: preferences.workModes,
    minSalary: preferences.minSalary,
    currency: preferences.currency
  }, null, 2)}

JOBS:
${JSON.stringify(jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    workMode: j.workMode,
    employmentType: j.employmentType,
    salaryText: j.salaryText,
    postedAt: j.postedAt,
    description: String(j.description || '').slice(0, 3500),
    detectedSkills: j.signals?.mentionedSkills?.map((s) => s.name).slice(0, 30) || [],
    detectedRequired: j.signals?.requiredSkills?.map((s) => s.name).slice(0, 20) || [],
    detectedPreferred: j.signals?.preferredSkills?.map((s) => s.name).slice(0, 20) || []
  })), null, 2)}

Return JSON exactly in this shape:
{
  "matches": [
    {
      "id": "the job id",
      "score": 0,
      "why": "2-5 specific sentences",
      "matchedSkills": ["skills from the candidate profile"],
      "matchedRequired": ["required skills the candidate has"],
      "missingRequired": ["required skills the candidate lacks"],
      "matchedPreferred": ["preferred skills the candidate has"],
      "missingPreferred": ["preferred skills the candidate lacks"],
      "requiredSkills": ["required skills found in the posting"],
      "preferredSkills": ["preferred skills found in the posting"],
      "experienceAssessment": "one sentence",
      "locationAssessment": "one sentence about location/work authorization",
      "educationAssessment": "one sentence",
      "verdict": "one sentence on whether it is worth applying",
      "confidence": "high|medium|low",
      "notes": "optional caveat"
    }
  ]
}

Every input job id must appear exactly once.`;
}
