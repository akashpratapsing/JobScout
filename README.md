# JobScout

JobScout is a local, privacy-first job **discovery** app. Upload a PDF or DOCX resume, review the extracted profile, set preferences, search live job sources, and get an honest 0–100 match score with a clear explanation.

It runs entirely on your machine. There is no hosting requirement, no paid subscription, no cloud database, and **no automatic job applications**. JobScout never submits forms, sends recruiter messages, or requests referrals.

- **Stack:** Node.js 22, vanilla HTML/CSS/JS, zero build step
- **Default URL:** `http://127.0.0.1:4317`
- **Data:** `data/app.json` (atomic writes) plus `data/.secret` for encryption
- **Dependencies:** `pdfjs-dist`, `mammoth`, `busboy`

---

## Quick start

```powershell
# From the project directory
npm install
npm start
```

Open <http://127.0.0.1:4317>.

On first use:

1. Go to **Resume & profile** and upload a text-based PDF or DOCX.
2. Review every extracted field. Correct anything that is wrong and click **Save profile**.
3. Go to **Preferences**, set titles, locations/countries, work modes, salary, and sources. Add public board tokens for the ATS sources you want.
4. Go to **Dashboard** and click **Search now**.
5. Open a job to see the score, matched and missing skills, experience/location assessment, original URL, source, and last-verified time.

Optional environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Bind address | `127.0.0.1` |
| `PORT` | HTTP port | `4317` |
| `JOB_SCOUT_DATA_DIR` | Data directory | `./data` |

JobScout binds to localhost by default. Do not expose it to the public internet; it has no multi-user authentication.

JobScout does **not** load a `.env` file automatically. Set these variables in your shell, or start Node with its built-in env-file support:

```powershell
node --env-file=.env server/index.js
```

AI provider keys and job-source credentials are **not** environment variables. They are entered in the UI and stored encrypted under `data/`; see [Privacy](#privacy).

---

## What it does

- Extracts resume text locally from PDF/DOCX (and `.txt`/`.md` for testing).
- Parses skills, experience, projects, education, certifications, links, keywords, experience level, and suggested titles.
- Lets you edit and save the profile without re-uploading the resume.
- Searches permitted, live job sources in parallel.
- Normalizes listings, removes duplicates, and preserves alternate source references.
- Scores every job against your profile using deterministic rules.
- Optionally improves the top matches with a cloud AI provider, within deterministic score caps.
- Shows why a role is a good fit, a stretch, or a skip — including missing required and preferred skills.
- Tracks saved, applied, dismissed, and expired jobs without ever applying for you.
- Rechecks stale listings for expiry when the source allows it.
- Runs an optional daily search inside a 20-minute grace window.

---

## Supported live sources

These connectors are implemented and were exercised against real endpoints. They require no login, bypass no CAPTCHA, and follow each source's public access method.

| Source | Access method | Configuration |
|---|---|---|
| **Greenhouse** | Official public job-board API | Public board token(s), e.g. `stripe` |
| **Lever** | Public postings API | Public board token(s), e.g. `paytm` |
| **Ashby** | Public job-board API | Public board token(s), e.g. `openai` |
| **Workday** | Public CXS tenant endpoints | `tenant \| wd \| site \| label` per line |
| **Workable** | Public careers widget/API | Public board token(s) |
| **Recruitee** | Public careers API | Public board token(s) |
| **SmartRecruiters** | Public postings API (best effort) | Public company identifier(s) |
| **Remote OK** | Public JSON feed | None |
| **Remotive** | Public API | None |
| **We Work Remotely** | Public RSS feed | None |
| **Himalayas** | Public API | None |
| **Arbeitnow** | Public API | None |
| **Jobicy** | Public API | None |
| **Adzuna** | Free developer API | App ID + app key |
| **Company career pages** | Schema.org `JobPosting` JSON-LD only | One career-page URL per line |

Notes:

- ATS connectors only see boards/tenants that are publicly exposed. A valid token is not a guarantee of results.
- Workday boards are employer-specific. The three preloaded boards (Salesforce, Accenture, Capital One) returned live postings when this version was written; other tenants may return an HTML "currently unavailable" page, redirect to a non-Workday careers site, or need a different site ID. Add or replace boards in Preferences.
- Workable and SmartRecruiters public feeds are inconsistent across tenants. Zero results are reported honestly as zero, never replaced with fake listings.
- The custom career-page connector reads JSON-LD only. It does not scrape arbitrary HTML, bypass logins, or ignore access controls. It checks `robots.txt` first.
- Every connector uses per-host rate limiting, retries with backoff, request timeouts, and `robots.txt` checks where applicable.

### Adzuna setup

1. Create a free Adzuna developer account and app at <https://developer.adzuna.com/>.
2. In **Preferences → Adzuna**, enter the app ID, app key, and two-letter country code (e.g. `in`, `us`, `gb`).
3. Enable the Adzuna source.

The app key is encrypted at rest and never returned to the browser. If you leave the key field blank after saving, the existing key is kept. Use **Remove saved Adzuna key** to delete it.

### Not integrated

These sites do **not** provide a public jobs API suitable for this app, or their terms restrict automated access. JobScout does not scrape them, pretend to integrate them, or bypass their controls. Instead, the Sources page provides manual search deep links:

- LinkedIn Jobs
- Indeed
- Glassdoor
- Dice
- Naukri
- Foundit
- Instahyre
- Hirist
- Cutshort
- Wellfound

Manual links open the site in your browser so you can search and apply yourself.

---

## Matching and scoring

Every job gets a deterministic **rules** score. If AI is enabled, the highest-ranked new or changed jobs can be re-evaluated by the model, but the model cannot inflate a score past the deterministic caps.

Rules weights:

| Component | Max |
|---|---|
| Required skills | 38 |
| Preferred skills | 10 |
| Experience fit | 16 |
| Seniority fit | 10 |
| Title similarity | 10 |
| Location / work-mode eligibility | 10 |
| Education | 3 |
| Project evidence | 3 |

Guardrails:

- Missing 1 required skill caps the score at 82.
- Missing 2+ required skills caps the score at 64.
- Required-skill coverage below 50% caps the score at 60; below 70% caps it at 76.
- A location/authorization mismatch caps the score at 55.
- An experience gap of 3+ years caps the score at 65; 2+ years caps it at 75.
- A seniority gap of 2+ levels caps the score at 68.
- A posting with no explicit requirements is capped at 88.
- AI output is merged conservatively: any required skill detected as missing by either pass stays missing.

Each result explains matched required skills, missing required skills, matched/missing preferred skills, experience fit, location eligibility, education, and a recommendation (`apply`, `consider`, or `skip`). Scores are evidence-based, not a guarantee of an interview.

---

## AI providers (optional)

JobScout uses cloud AI only. There is **no local LLM, no Ollama, no automatic paid fallback, and no credit purchase**. AI is disabled by default.

| Provider | Default model | Free-tier note |
|---|---|---|
| Google Gemini | `gemini-3.5-flash` | Free tier with model-specific RPM/RPD limits |
| Groq | `openai/gpt-oss-120b` | Free plan rate limits apply |
| OpenRouter | `nvidia/nemotron-3-ultra-550b-a55b:free` | Only model IDs ending in `:free` are allowed |
| Mistral | `mistral-small-latest` | Free experiment tier has limits |
| Cerebras | `llama-3.3-70b` | Free tier has daily token limits |
| Custom | Your model | Any OpenAI-compatible endpoint you control |

Free-tier limits change. Check the provider's current documentation in **Settings** before relying on a model.

Safety and quota behavior:

- Keys are encrypted with AES-256-GCM using `data/.secret` and are never serialized to the frontend or written to logs.
- The Settings screen can test a key and list models without saving them first.
- Rate limits, quota exhaustion, and auth failures are mapped to clear errors.
- A failed AI run keeps the deterministic rules score and is labelled honestly.
- After repeated failures the provider enters a cooldown; searches continue with rules-only scoring.
- OpenRouter is restricted to `:free` models. JobScout will reject a paid model ID.
- If you use a custom endpoint, you are responsible for its terms and costs. JobScout never enables billing.

To enable AI:

1. Open **Settings**.
2. Choose a provider, paste a key, and optionally choose a model.
3. Click **Test** / **List models** to verify access.
4. Enable AI and save.

---

## Privacy

- Resume text and profile data stay in `data/app.json` on your machine.
- Resume text is sent to a cloud AI provider only when you explicitly run **Analyze with AI** or an AI-enabled search. The UI discloses which provider/model will receive data.
- **Settings → Privacy** controls whether full resume text or only the structured profile is sent.
- Uploading a new resume replaces the profile; deleting the resume removes resume text and profile fields.
- **Delete everything** removes the profile, jobs, runs, preferences, and encrypted API keys.
- Export produces a JSON copy with encrypted keys and credential blocks removed.
- API keys are masked in the UI, redacted from logs, and encrypted at rest.
- JobScout does not send recruiter messages, referrals, applications, or form submissions.

The app is intended for a single local user. It has no login system and should remain bound to `127.0.0.1`.

---

## Search lifecycle

A manual search:

1. Runs enabled connectors in parallel (up to 3 at a time).
2. Normalizes listings and filters by titles, locations, work mode, company rules, and age.
3. Deduplicates against stored jobs.
4. Recomputes signals and rules scores for new or changed jobs.
5. Optionally AI-scores the top new/changed jobs (up to 80 per run).
6. Rechecks up to 12 stale posting URLs for expiry.
7. Saves jobs, run statistics, per-source status, and source errors.

`POST /api/search` returns `{ runId }` immediately. The frontend watches progress through `GET /api/runs/:id` and the `/api/events` SSE stream. You can keep using the app while a search runs.

### Duplicate detection

A listing is treated as the same job when any of these hold:

- Canonical URL matches after removing tracking parameters.
- Company + requisition ID matches.
- Company + normalized title + location matches, and descriptions are sufficiently similar.

Different non-empty requisition IDs are **never** merged, even when titles look alike. Alternate sources are retained in `sources[]` with their own URLs and requisition IDs. Jobs with different locations or clearly different descriptions are kept separate.

### Expiry checks

Stale listings are rechecked at their original URL. A job is marked expired only when the page returns 404/410 or clearly says the role is closed. If `robots.txt` blocks the check, the network fails, or the page cannot be interpreted, the job is left unchanged and the check is reported as skipped. JobScout does not claim a listing is active when it could not verify it.

### Daily schedule

Enable **Preferences → Daily search** and choose a local time and timezone.

- The scheduler checks every 30 seconds.
- A search runs only inside a 20-minute grace window after the configured time.
- Missed days are not caught up later.
- If a search is already running, no profile exists, or no sources are enabled, the run is skipped with a log message.
- The date is recorded before the run starts, so a failed run does not retry in a loop.

---

## Data model

`data/app.json` contains:

- `profile` — extracted/edited resume profile
- `preferences` — titles, locations, work modes, salary, companies, sources, boards, schedule
- `settings` — AI provider config, encrypted keys, privacy flags
- `jobs` — normalized listings, source references, match results, status history
- `runs` — last 60 search runs with source stats and errors
- `sourceState` — last run status per source
- `meta` — timestamps and last search status

Writes are atomic and a backup is kept under `data/backups/`. Do not commit `data/`; it is already in `.gitignore`.

---

## API overview

All endpoints are local JSON endpoints. There is no public API contract or multi-user auth.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness and profile presence |
| `GET` | `/api/state` | Profile, preferences, settings, stats, sources, active run |
| `GET` | `/api/jobs` | Filter/sort/paginate jobs |
| `GET` | `/api/jobs/:id` | Full job detail |
| `POST` | `/api/jobs/:id/status` | Save/dismiss/mark applied, update notes |
| `POST` | `/api/jobs/:id/verify` | Recheck a listing URL |
| `POST` | `/api/jobs/clear` | Clear job history |
| `POST` | `/api/resume/upload` | Upload and extract a resume |
| `GET/PUT/DELETE` | `/api/profile` | Read, update, or delete the profile |
| `POST` | `/api/profile/analyze` | Optional AI profile analysis |
| `GET/PUT` | `/api/preferences` | Read or update preferences |
| `GET/PUT` | `/api/settings` | Read or update AI/privacy settings |
| `POST` | `/api/settings/ai/test` | Test a provider key without saving |
| `POST` | `/api/settings/ai/models` | List models without saving |
| `POST` | `/api/search` | Start a search, returns `{ runId }` |
| `GET` | `/api/runs` | Recent runs |
| `GET` | `/api/runs/:id` | Run progress/result |
| `DELETE` | `/api/runs` | Clear run history |
| `GET` | `/api/events` | SSE stream of run updates |
| `GET` | `/api/manual-links` | Deep links for unsupported portals |
| `GET` | `/api/export` | JSON export without secrets |
| `POST` | `/api/privacy/delete` | Delete resume, jobs, or everything |

---

## Project layout

```
server/
  index.js                 HTTP server, API routes, SSE, static files
  resume.js                PDF/DOCX extraction and profile parsing
  scheduler.js             Daily search scheduler
  lib/                     Config, store, crypto, logger, HTTP, validation, serialization
  matching/                Skills, location, requirement extraction, scoring
  ai/                      Provider adapters, prompts, AI matching
  jobs/
    registry.js            Source catalog and manual links
    http.js                Rate-limited HTTP client, retries, robots.txt
    discovery.js           Search orchestrator and expiry verification
    dedupe.js              Duplicate detection and merging
    connectors/            One module per live source
public/
  index.html               Single-page UI
  app.js                   Vanilla JS frontend
  styles.css               Styles
  favicon.svg
scripts/
  live-smoke.js            Live connector smoke test
  make-fixtures.py         Generates sample PDF/DOCX fixtures
test/                      Node test suite and fixtures
.github/workflows/ci.yml   CI: npm test on Node.js 20 and 22
data/                      Local data (created at runtime, gitignored)
```

---

## Testing

```powershell
# Unit and integration tests (mocked sources, no network)
npm test

# Live smoke test against real public sources (default 12-source set)
npm run test:live

# Smaller live run
node scripts/live-smoke.js --sources=greenhouse,lever,ashby,remoteok --boards=1 --max=20

# Regenerate the sample PDF/DOCX fixtures (requires Python packages)
npm run fixtures
```

> **PowerShell note:** PowerShell drops the `--` separator when calling `npm`, so
> `npm run test:live -- --sources=...` silently runs the default set. Call
> `node scripts/live-smoke.js` directly (as above), use `cmd /c "npm run test:live -- --sources=..."`,
> or set the `LIVE_*` environment variables listed below.

`npm run test:live` uses a temporary data directory, loads the bundled sample resume, and prints honest per-source scanned/job/warning counts. It never writes to your real `data/` directory.

Adzuna is skipped in the live smoke test unless `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set. Custom career pages are skipped unless `LIVE_CUSTOM_URLS` contains comma-separated URLs.

Useful live-smoke options:

```powershell
node scripts/live-smoke.js --sources=remoteok,remotive,himalayas
node scripts/live-smoke.js --titles="Backend Engineer,Data Engineer" --boards=2 --max=60
```

The same options can be supplied through environment variables, which work from any shell:
`LIVE_SOURCES`, `LIVE_TITLES`, `LIVE_BOARDS`, `LIVE_MAX_RESULTS`, `LIVE_MAX_AGE_DAYS`,
`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and `LIVE_CUSTOM_URLS`.

---

## Limitations

- **Discovery only.** No automatic applications, form submissions, resume uploads to employers, recruiter messages, referral requests, or browser automation.
- **No login-based sources.** LinkedIn, Indeed, Glassdoor, Dice, Naukri, Foundit, Instahyre, Hirist, Cutshort, and Wellfound are manual-search links only.
- **Public boards only.** Private or authenticated ATS boards are not accessed.
- **Feeds can be stale.** A source may still list a closed role; JobScout marks expiry only when it can verify it.
- **Best-effort expiry checks.** `robots.txt`, timeouts, or ambiguous pages result in “skipped”, not a false active/expired claim.
- **Conservative extraction.** Salary and experience parsing is deliberately cautious. Missing values are shown as missing rather than guessed.
- **AI is optional and capped.** Free-tier limits can change or run out. Rules-only matching always works.
- **Single-user local app.** No accounts, roles, or remote access controls.
- **Not every career page is supported.** Custom pages must publish schema.org `JobPosting` JSON-LD and allow crawling.
- **Windows-first.** It runs on Node.js wherever the dependencies work, but the documented commands use PowerShell.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| `EADDRINUSE` | Another process is using port 4317. Set `PORT` or stop the other process. |
| Resume upload says scanned/image-only | The PDF has no selectable text. Upload a text-based PDF or DOCX; OCR is not enabled. |
| No jobs returned | Narrow titles, age filters, empty boards, rate limits, or temporarily unavailable feeds. Check **Activity → source errors**. |
| ATS source returns 0 | The board token may be private, empty, renamed, or not publicly exposed. Try another token. |
| SmartRecruiters returns 0 | Many tenants restrict public postings. This is expected and reported honestly. |
| AI test fails | Check the key, model, provider status, and free-tier limits. Paid models are rejected for OpenRouter. |
| Search feels slow | Connectors are rate-limited on purpose. Reduce enabled sources or boards for faster runs. |
| Scheduled search did not run | The app must be running inside the 20-minute grace window; missed days are not caught up. |

---

## Contributing

1. Fork the repository and create a branch.
2. Run `npm install` and `npm test` before making changes.
3. Keep the rules-only path working: AI providers are optional and must never become required for a search.
4. Do not commit anything under `data/`, `.env` files, API keys, logs, or real resume data. The sample fixtures in `test/fixtures/` must stay fictional.
5. Open a pull request describing the change and the tests you ran.

Continuous integration runs `npm test` on Node.js 20 and 22 via `.github/workflows/ci.yml`.

---

## License and responsible use

This project is for personal, local job discovery. Respect each source's terms of service, `robots.txt`, rate limits, and applicable law. Do not use JobScout to scrape authenticated pages, bypass access controls, or automate applications. JobScout is provided as-is, without warranty; always review the original posting before applying.
