const CITY_ALIASES = {
  bengaluru: ['bangalore', 'bengaluru', 'blr'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai'],
  'new delhi': ['new delhi', 'delhi', 'ncr', 'gurugram', 'gurgaon', 'noida', 'faridabad', 'ghaziabad'],
  hyderabad: ['hyderabad', 'secunderabad', 'hyd'],
  chennai: ['chennai', 'madras'],
  pune: ['pune', 'poona'],
  kolkata: ['kolkata', 'calcutta'],
  ahmedabad: ['ahmedabad', 'gandhinagar'],
  jaipur: ['jaipur'],
  kochi: ['kochi', 'cochin', 'ernakulam'],
  indore: ['indore'],
  coimbatore: ['coimbatore'],
  chandigarh: ['chandigarh', 'mohali', 'panchkula'],
  lucknow: ['lucknow'],
  bhubaneswar: ['bhubaneswar'],
  mysuru: ['mysore', 'mysuru'],
  nagpur: ['nagpur'],
  vadodara: ['vadodara', 'baroda'],
  surat: ['surat'],
  thiruvananthapuram: ['thiruvananthapuram', 'trivandrum'],
  visakhapatnam: ['visakhapatnam', 'vizag'],
  'san francisco': ['san francisco', 'sf bay area', 'bay area'],
  'new york': ['new york', 'nyc', 'new york city'],
  london: ['london'],
  berlin: ['berlin'],
  amsterdam: ['amsterdam'],
  dublin: ['dublin'],
  singapore: ['singapore'],
  dubai: ['dubai'],
  toronto: ['toronto'],
  vancouver: ['vancouver'],
  sydney: ['sydney'],
  melbourne: ['melbourne'],
  tokyo: ['tokyo'],
  bangkok: ['bangkok'],
  'hong kong': ['hong kong'],
  seoul: ['seoul'],
  'tel aviv': ['tel aviv'],
  boston: ['boston'],
  seattle: ['seattle'],
  austin: ['austin'],
  chicago: ['chicago'],
  'los angeles': ['los angeles', 'la'],
  denver: ['denver'],
  atlanta: ['atlanta'],
  dallas: ['dallas'],
  houston: ['houston'],
  washington: ['washington', 'dc'],
  paris: ['paris'],
  madrid: ['madrid'],
  barcelona: ['barcelona'],
  lisbon: ['lisbon'],
  warsaw: ['warsaw'],
  stockholm: ['stockholm'],
  zurich: ['zurich'],
  munich: ['munich'],
  'tel aviv-yafo': ['tel aviv-yafo']
};

export const COUNTRIES = [
  'India', 'United States', 'USA', 'Canada', 'United Kingdom', 'UK', 'Ireland', 'Germany',
  'France', 'Netherlands', 'Spain', 'Portugal', 'Poland', 'Sweden', 'Switzerland', 'Italy',
  'Australia', 'New Zealand', 'Singapore', 'United Arab Emirates', 'UAE', 'Saudi Arabia',
  'Qatar', 'Japan', 'South Korea', 'China', 'Hong Kong', 'Taiwan', 'Indonesia', 'Malaysia',
  'Philippines', 'Vietnam', 'Thailand', 'Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia',
  'South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Israel', 'Turkey', 'Ukraine', 'Czech Republic',
  'Austria', 'Belgium', 'Denmark', 'Norway', 'Finland', 'Romania', 'Hungary', 'Greece'
];

const COUNTRY_ALIASES = {
  India: ['india', 'bharat', 'in'],
  'United States': ['united states', 'usa', 'u.s.a', 'us', 'u.s.', 'america'],
  Canada: ['canada', 'ca'],
  'United Kingdom': ['united kingdom', 'uk', 'u.k.', 'great britain', 'england', 'scotland', 'wales'],
  Ireland: ['ireland'],
  Germany: ['germany', 'deutschland'],
  France: ['france'],
  Netherlands: ['netherlands', 'holland'],
  Spain: ['spain'],
  Portugal: ['portugal'],
  Poland: ['poland'],
  Sweden: ['sweden'],
  Switzerland: ['switzerland'],
  Australia: ['australia'],
  'New Zealand': ['new zealand'],
  Singapore: ['singapore'],
  'United Arab Emirates': ['united arab emirates', 'uae', 'dubai', 'abu dhabi'],
  'Saudi Arabia': ['saudi arabia', 'riyadh', 'jeddah'],
  Japan: ['japan'],
  'South Korea': ['south korea', 'korea'],
  China: ['china'],
  'Hong Kong': ['hong kong'],
  Taiwan: ['taiwan'],
  Indonesia: ['indonesia'],
  Malaysia: ['malaysia'],
  Philippines: ['philippines'],
  Vietnam: ['vietnam'],
  Thailand: ['thailand'],
  Brazil: ['brazil'],
  Mexico: ['mexico'],
  Argentina: ['argentina'],
  Chile: ['chile'],
  Colombia: ['colombia'],
  'South Africa': ['south africa'],
  Nigeria: ['nigeria'],
  Kenya: ['kenya'],
  Egypt: ['egypt'],
  Israel: ['israel', 'tel aviv'],
  Turkey: ['turkey', 'türkiye'],
  Ukraine: ['ukraine'],
  'Czech Republic': ['czech republic', 'czechia', 'prague'],
  Austria: ['austria', 'vienna'],
  Belgium: ['belgium', 'brussels'],
  Denmark: ['denmark', 'copenhagen'],
  Norway: ['norway', 'oslo'],
  Finland: ['finland', 'helsinki'],
  Romania: ['romania', 'bucharest'],
  Hungary: ['hungary', 'budapest'],
  Greece: ['greece', 'athens']
};

export function normalizeLocation(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\b(india|remote|hybrid|on-?site|anywhere|worldwide)\b/g, ' ')
    .replace(/[^a-z0-9\s,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

export function canonicalCity(raw) {
  const text = String(raw || '').toLowerCase();
  for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((alias) => new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text))) {
      return canonical;
    }
  }
  return null;
}

export function detectCountry(text) {
  const haystack = ` ${String(text || '').toLowerCase()} `;
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    for (const alias of aliases) {
      if (alias.length <= 3 && !['uae', 'usa', 'uk'].includes(alias)) continue;
      const pattern = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (pattern.test(haystack)) return country;
    }
  }
  const city = canonicalCity(text);
  if (city) {
    const indianCities = ['bengaluru', 'mumbai', 'new delhi', 'hyderabad', 'chennai', 'pune', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'indore', 'coimbatore', 'chandigarh', 'lucknow', 'bhubaneswar', 'mysuru', 'nagpur', 'vadodara', 'surat', 'thiruvananthapuram', 'visakhapatnam'];
    if (indianCities.includes(city)) return 'India';
  }
  return null;
}

export function detectWorkMode({ title = '', location = '', description = '', hint = '' } = {}) {
  const hintText = String(hint || '').toLowerCase();
  if (/hybrid/.test(hintText)) return 'hybrid';
  if (/remote|telecommut|work from home|wfh|distributed/.test(hintText)) return 'remote';
  if (/on-?site|office|in-person/.test(hintText)) return 'onsite';

  const short = `${title} ${location}`.toLowerCase();
  if (/\bhybrid\b/.test(short)) return 'hybrid';
  if (/\b(remote|anywhere|work from home|wfh|distributed)\b/.test(short)) return 'remote';
  if (/\b(on-?site|in[- ]office|in person)\b/.test(short)) return 'onsite';

  const body = String(description || '').slice(0, 6000).toLowerCase();
  if (/\b(hybrid|partially remote|\d+\s+days? (?:a|per) week in (?:the )?office)\b/.test(body)) return 'hybrid';
  if (/\b(fully remote|100% remote|remote[- ]first|work from anywhere|remote position|this role is remote)\b/.test(body)) return 'remote';
  if (/\b(on-?site|in[- ]office|in person|office-based)\b/.test(body)) return 'onsite';
  if (location && /remote|anywhere|worldwide/i.test(location)) return 'remote';
  if (location) return 'onsite';
  return 'unknown';
}

export function locationEligibility({ job, profile, preferences }) {
  const candidateCountry = detectCountry(profile?.location) || detectCountry((preferences?.countries || []).join(' ')) || 'India';
  const candidateCity = canonicalCity(profile?.location) || canonicalCity((preferences?.locations || []).join(' '));
  const jobText = `${job.location || ''} ${job.description || ''} ${job.title || ''}`;
  const jobCountry = detectCountry(job.location) || detectCountry(jobText.slice(0, 3000));
  const jobCity = canonicalCity(job.location);
  const mode = job.workMode || detectWorkMode(job);
  const lower = jobText.toLowerCase();
  const preferredCountries = (preferences?.countries || []).map((c) => c.toLowerCase());
  const preferredLocations = (preferences?.locations || []).map((l) => l.toLowerCase());
  const candidateCountryLower = candidateCountry.toLowerCase();

  const mentionsCandidate =
    lower.includes(candidateCountryLower) ||
    (candidateCity && lower.includes(candidateCity)) ||
    preferredLocations.some((loc) => loc && lower.includes(loc)) ||
    preferredCountries.some((c) => c && lower.includes(c));

  const restrictions = [];
  const restrictedPatterns = [
    [/\b(us|u\.s\.|usa|united states)[- ]only\b|\bmust be (?:based|located|authorized) in the (?:us|united states)\b|\bus work authorization\b|\bw-?2\b/, 'United States'],
    [/\b(canada)[- ]only\b|\bmust be (?:based|located) in canada\b/, 'Canada'],
    [/\b(uk|united kingdom)[- ]only\b|\bmust be (?:based|located) in the (?:uk|united kingdom)\b/, 'United Kingdom'],
    [/\b(eu|europe)[- ]only\b|\bmust be (?:based|located) in (?:the )?(?:eu|europe)\b|\beu work (?:authorization|permit)\b/, 'European Union'],
    [/\b(india)[- ]only\b|\bmust be (?:based|located) in india\b/, 'India'],
    [/\baustralia[- ]only\b|\bmust be (?:based|located) in australia\b/, 'Australia']
  ];
  for (const [pattern, country] of restrictedPatterns) {
    if (pattern.test(lower)) restrictions.push(country);
  }

  const candidateMatchesRestriction = restrictions.some((country) => {
    if (country === 'European Union') return ['germany', 'france', 'netherlands', 'spain', 'portugal', 'poland', 'sweden', 'ireland', 'italy', 'austria', 'belgium', 'denmark', 'finland', 'greece', 'czech republic', 'romania', 'hungary'].includes(candidateCountryLower);
    return country.toLowerCase() === candidateCountryLower || (country === 'United States' && candidateCountryLower === 'usa');
  });

  if (mode === 'remote') {
    if (mentionsCandidate || /worldwide|anywhere in the world|work from anywhere|global/.test(lower)) {
      return { status: 'eligible', reason: `Remote role open to candidates in ${candidateCountry}${candidateCity ? ` / ${candidateCity}` : ''}.` };
    }
    if (restrictions.length && !candidateMatchesRestriction) {
      return { status: 'restricted', reason: `Remote role appears restricted to ${restrictions.join(', ')}, not ${candidateCountry}.` };
    }
    if (restrictions.length && candidateMatchesRestriction) {
      return { status: 'eligible', reason: `Remote role appears open to ${candidateCountry}.` };
    }
    if (jobCountry && jobCountry !== candidateCountry && !mentionsCandidate) {
      return { status: 'possible', reason: `Remote role is listed from ${jobCountry}; confirm it accepts applicants from ${candidateCountry}.` };
    }
    return { status: 'possible', reason: 'Remote role; location eligibility is not explicitly stated.' };
  }

  if (jobCountry) {
    if (jobCountry === candidateCountry) {
      if (jobCity && candidateCity && jobCity !== candidateCity && !preferredLocations.some((l) => l.includes(jobCity))) {
        return { status: 'possible', reason: `Role is in ${job.location} (${jobCountry}); different city from your profile.` };
      }
      return { status: 'eligible', reason: `Role is located in ${jobCountry}.` };
    }
    if (preferredCountries.includes(jobCountry.toLowerCase())) {
      return { status: 'eligible', reason: `Role is in a preferred country (${jobCountry}).` };
    }
    return { status: 'restricted', reason: `Role is on-site/hybrid in ${jobCountry}; you are in ${candidateCountry}.` };
  }

  return { status: 'possible', reason: 'Location eligibility could not be determined from the posting.' };
}
