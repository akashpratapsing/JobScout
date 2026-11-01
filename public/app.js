'use strict';

const state = {
  data: null,
  jobs: [],
  total: 0,
  offset: 0,
  limit: 30,
  page: 'dashboard',
  runs: [],
  activeRun: null,
  watchingRunId: null,
  watchTimer: null,
  lastCompletedRunId: null,
  loadingJobs: false,
  loadingState: false,
  uploading: false,
  profileDirty: false,
  prefsDirty: false,
  settingsDirty: false,
  currentJob: null,
  confirmResolve: null,
  filters: {
    q: '',
    status: '',
    source: '',
    workMode: '',
    minScore: '',
    sort: 'score',
    includeExpired: false
  }
};

const PAGE_META = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Ranked roles from sources you can access legitimately.'
  },
  profile: {
    title: 'Resume & profile',
    subtitle: 'Extract locally, review carefully, and correct anything that looks wrong.'
  },
  preferences: {
    title: 'Preferences',
    subtitle: 'Titles, locations, work modes, salary, and source boards.'
  },
  sources: {
    title: 'Sources',
    subtitle: 'What is fetched live, what needs configuration, and what is manual-only.'
  },
  activity: {
    title: 'Activity',
    subtitle: 'Search runs, source errors, and verification history.'
  },
  settings: {
    title: 'Settings',
    subtitle: 'AI provider, privacy, exports, and data deletion.'
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'http:' || url.protocol === 'https:') return esc(url.toString());
  } catch {
    // Ignore invalid URLs.
  }
  return '#';
}

function cssEscape(value) {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function lines(value) {
  return String(value ?? '')
    .split(/\n|,/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function newlineList(value) {
  return String(value ?? '')
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function scoreClass(score) {
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 55) return 'weak';
  return 'poor';
}

function workModeLabel(mode) {
  return ({ remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Mode unknown' })[mode] || 'Mode unknown';
}

function statusLabel(status) {
  return ({ new: 'New', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed' })[status] || 'New';
}

function relativeTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.round(seconds / 86400)}d ago`;
  return formatDate(value);
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function durationText(ms) {
  if (!Number.isFinite(Number(ms))) return '';
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatSalary(job) {
  if (job.salaryText) return job.salaryText;
  if (!job.salary || !Number.isFinite(Number(job.salary.min))) return '';
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const min = formatter.format(Number(job.salary.min));
  const max = Number(job.salary.max);
  const range = Number.isFinite(max) && max !== Number(job.salary.min) ? `${min}–${formatter.format(max)}` : min;
  return `${job.salary.currency || ''} ${range} / ${job.salary.period || 'year'}`.trim();
}

function toast(message, type = 'info', timeout = 4500) {
  const stack = $('#toast-stack');
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = String(message || '');
  stack.appendChild(item);
  setTimeout(() => item.remove(), timeout);
}

function showBanner(message, type = 'info') {
  const banner = $('#global-banner');
  banner.textContent = String(message || '');
  banner.className = `banner ${type}`;
  banner.classList.remove('hidden');
}

function hideBanner() {
  $('#global-banner').classList.add('hidden');
}

async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.code || '';
    throw error;
  }
  return data;
}

function setButtonLoading(button, loading, label = 'Working…') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('loading');
    button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = true }) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const ok = $('#confirm-ok');
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  $('#confirm-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => ok.focus(), 20);
  return new Promise((resolve) => {
    state.confirmResolve = resolve;
  });
}

function closeConfirm(value) {
  $('#confirm-modal').classList.add('hidden');
  if ($('#job-modal').classList.contains('hidden')) document.body.classList.remove('modal-open');
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (resolve) resolve(value);
}

async function loadState({ forceForms = false } = {}) {
  if (state.loadingState) return;
  state.loadingState = true;
  try {
    const data = await api('/api/state');
    applyState(data, { forceForms });
    hideBanner();
  } catch (error) {
    showBanner(`Could not load JobScout state: ${error.message}`, 'error');
  } finally {
    state.loadingState = false;
  }
}

function applyState(data, { forceForms = false } = {}) {
  state.data = data;
  if (data.activeRun) state.activeRun = data.activeRun;
  $('#app-version').textContent = `v${data.app?.version || '1.0.0'}`;
  updateSidebarAI();
  renderStats(data.stats);
  renderOnboarding();
  renderSourceFilter();
  renderMatchesSubtitle();
  if (forceForms || !state.profileDirty) renderProfile(forceForms);
  if (forceForms || !state.prefsDirty) renderPreferences(forceForms);
  renderSources();
  if (forceForms || !state.settingsDirty) renderSettings(forceForms);
  updateSearchUI();
  if (state.activeRun?.status === 'running') {
    renderProgress(state.activeRun);
    watchRun(state.activeRun.id);
  }
}

function updateSidebarAI() {
  const pill = $('#sidebar-ai');
  const settings = state.data?.settings;
  if (settings?.ai?.enabled && settings.ai.hasKey) {
    pill.textContent = `AI on · ${settings.ai.model || settings.ai.provider}`;
    pill.classList.remove('off');
  } else {
    pill.textContent = 'AI not configured';
    pill.classList.add('off');
  }
}

function renderStats(stats = {}) {
  $('#stat-active').textContent = stats.active ?? 0;
  $('#stat-strong').textContent = stats.strong ?? 0;
  $('#stat-saved').textContent = stats.saved ?? 0;
  $('#stat-applied').textContent = stats.applied ?? 0;
  $('#stat-new').textContent = `${stats.newThisWeek ?? 0} new this week`;
}

function renderOnboarding() {
  const hasProfile = Boolean(state.data?.profile);
  $('#onboarding-card').classList.toggle('hidden', hasProfile);
}

function renderMatchesSubtitle() {
  const stats = state.data?.stats || {};
  const meta = state.data?.meta || {};
  const target = $('#matches-subtitle');
  if (!state.data?.profile) {
    target.textContent = 'Add a resume first. Then JobScout can rank roles against your actual skills and experience.';
    return;
  }
  if (!meta.lastSearchAt) {
    target.textContent = 'No search yet. Run a search to fetch roles from your enabled sources.';
    return;
  }
  const status = meta.lastSearchStatus === 'error' ? ' · last search failed' : '';
  target.textContent = `Last search ${relativeTime(meta.lastSearchAt)} · ${stats.active || 0} active roles · ${stats.aiScored || 0} AI-scored, ${stats.rulesScored || 0} rules-scored${status}`;
}

function renderSourceFilter() {
  const select = $('#filter-source');
  if (!select) return;
  const current = state.filters.source;
  const sources = state.data?.sources || [];
  select.innerHTML = `<option value="">All sources</option>${sources.map((source) => `<option value="${esc(source.id)}">${esc(source.label)}</option>`).join('')}`;
  select.value = current;
}

function updateSearchUI() {
  const running = state.activeRun?.status === 'running';
  const button = $('#search-btn');
  const status = $('#search-state');
  button.disabled = running;
  button.innerHTML = running
    ? '<span class="spinner"></span><span>Searching…</span>'
    : `${icon('search')}<span>Search now</span>`;
  if (running) {
    status.textContent = 'Searching';
    status.className = 'status-pill running';
  } else if (!state.data?.profile) {
    status.textContent = 'No resume';
    status.className = 'status-pill';
  } else if (state.data?.meta?.lastSearchStatus === 'error') {
    status.textContent = 'Last search failed';
    status.className = 'status-pill error';
  } else {
    status.textContent = 'Ready';
    status.className = 'status-pill';
  }
}

async function loadJobs(reset = true) {
  if (state.loadingJobs) return;
  if (!state.data?.profile) {
    state.jobs = [];
    state.total = 0;
    renderJobs();
    return;
  }
  if (reset) {
    state.offset = 0;
    state.jobs = [];
  }
  state.loadingJobs = true;
  try {
    const params = new URLSearchParams();
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.status) params.set('status', state.filters.status);
    if (state.filters.source) params.set('source', state.filters.source);
    if (state.filters.workMode) params.set('workMode', state.filters.workMode);
    if (state.filters.minScore) params.set('minScore', state.filters.minScore);
    if (state.filters.sort) params.set('sort', state.filters.sort);
    if (state.filters.includeExpired) params.set('includeExpired', '1');
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));
    const data = await api(`/api/jobs?${params.toString()}`);
    state.jobs = reset ? data.jobs : [...state.jobs, ...data.jobs];
    state.total = data.total;
    if (data.stats) {
      state.data.stats = data.stats;
      renderStats(data.stats);
    }
    renderJobs();
  } catch (error) {
    toast(`Could not load matches: ${error.message}`, 'error');
  } finally {
    state.loadingJobs = false;
  }
}

function renderJobs() {
  const list = $('#job-list');
  const empty = $('#jobs-empty');
  const loadMore = $('#load-more');
  if (!state.jobs.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    loadMore.classList.add('hidden');
    if (!state.data?.profile) {
      $('#jobs-empty-title').textContent = 'No resume yet';
      $('#jobs-empty-text').textContent = 'Add a resume so JobScout can match roles against your skills, experience, and preferences.';
    } else if (state.data?.meta?.lastSearchAt) {
      $('#jobs-empty-title').textContent = 'No roles match these filters';
      $('#jobs-empty-text').textContent = 'Try clearing filters, lowering the minimum score, or running a fresh search.';
    } else {
      $('#jobs-empty-title').textContent = 'No matches yet';
      $('#jobs-empty-text').textContent = 'Run a search to discover roles from sources with public, permitted access.';
    }
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.jobs.map(renderJobCard).join('');
  loadMore.classList.toggle('hidden', state.jobs.length >= state.total);
}

function badge(text, className = '') {
  return `<span class="badge ${className}">${esc(text)}</span>`;
}

function renderJobCard(job) {
  const match = job.match || {};
  const score = clampScore(match.score);
  const status = job.status || 'new';
  const classes = [
    'job-card',
    status === 'saved' ? 'saved' : '',
    status === 'applied' ? 'applied' : '',
    status === 'dismissed' ? 'dismissed' : '',
    job.active === false ? 'expired' : ''
  ].filter(Boolean).join(' ');
  const salary = formatSalary(job);
  const matched = (match.matchedRequired || []).slice(0, 4);
  const missing = (match.missingRequired || []).slice(0, 4);
  const preferred = (match.matchedPreferred || []).slice(0, 2);
  const chips = [
    ...matched.map((skill) => `<span class="chip">${esc(skill)}</span>`),
    ...preferred.map((skill) => `<span class="chip pref">${esc(skill)}</span>`),
    ...missing.map((skill) => `<span class="chip missing">Missing: ${esc(skill)}</span>`)
  ];
  const moreMatched = (match.matchedRequired || []).length - matched.length;
  if (moreMatched > 0) chips.push(`<span class="chip more">+${moreMatched} matched</span>`);
  const moreMissing = (match.missingRequired || []).length - missing.length;
  if (moreMissing > 0) chips.push(`<span class="chip missing">+${moreMissing} missing</span>`);

  const statusBadge = status !== 'new' ? badge(statusLabel(status), status === 'applied' ? 'good' : status === 'dismissed' ? 'warn' : '') : '';
  const expiredBadge = job.active === false ? badge('Expired', 'danger') : '';
  const methodBadge = badge(match.method === 'ai' ? 'AI match' : 'Rules match', match.method === 'ai' ? 'ai' : 'rules');
  const recommendation = match.recommendation === 'apply' ? 'Worth applying' : match.recommendation === 'consider' ? 'Consider' : 'Skip';

  return `
    <article class="${classes}" data-job-id="${esc(job.id)}">
      <div class="job-head">
        <div>
          <button class="job-title" type="button" data-action="open-job" data-id="${esc(job.id)}">${esc(job.title)}</button>
          <div class="job-company">
            <span>${esc(job.company)}</span><span class="dot">·</span>
            <span>${esc(job.location || 'Location not specified')}</span><span class="dot">·</span>
            <span>${esc(workModeLabel(job.workMode))}</span>
          </div>
        </div>
        <div class="score-ring ${scoreClass(score)}" style="--score:${score}" title="${esc(match.verdict || 'Match score')}">
          <span>${score}</span><small>match</small>
        </div>
      </div>
      <div class="job-meta">
        ${badge(job.sourceLabel || job.source || 'Source', 'source')}
        ${statusBadge}${expiredBadge}${methodBadge}
        ${job.postedAt ? badge(`Posted ${relativeTime(job.postedAt)}`) : ''}
        ${job.experienceRequired ? badge(job.experienceRequired) : ''}
        ${job.employmentType ? badge(job.employmentType) : ''}
        ${salary ? badge(salary) : ''}
        ${badge(recommendation, match.recommendation === 'apply' ? 'good' : match.recommendation === 'consider' ? 'warn' : 'danger')}
      </div>
      ${job.summary ? `<p class="job-summary">${esc(job.summary)}</p>` : ''}
      ${chips.length ? `<div class="skill-row">${chips.join('')}</div>` : ''}
      ${match.why ? `<div class="job-why"><strong>Why this score:</strong> ${esc(match.why)}</div>` : ''}
      <div class="job-actions">
        <button class="btn ghost small" type="button" data-action="open-job" data-id="${esc(job.id)}">View details</button>
        <button class="btn ghost small" type="button" data-action="toggle-save" data-id="${esc(job.id)}" data-status="${esc(status)}">${status === 'saved' ? 'Unsave' : 'Save'}</button>
        <button class="btn ghost small" type="button" data-action="mark-applied" data-id="${esc(job.id)}" data-status="${esc(status)}">${status === 'applied' ? 'Applied ✓' : 'Mark applied'}</button>
        <button class="btn ghost small" type="button" data-action="dismiss" data-id="${esc(job.id)}">Dismiss</button>
        <span class="spacer"></span>
        <a class="btn ghost small" href="${safeUrl(job.url)}" target="_blank" rel="noopener noreferrer">Open original ${icon('external')}</a>
      </div>
      <div class="job-footnote">
        <span>Last verified ${relativeTime(job.lastVerifiedAt)}</span>
        ${job.firstSeenAt ? `<span>First seen ${relativeTime(job.firstSeenAt)}</span>` : ''}
        ${job.requisitionId ? `<span>Req ${esc(job.requisitionId)}</span>` : ''}
        ${job.duplicateCount ? `<span>${job.duplicateCount} alternate source${job.duplicateCount === 1 ? '' : 's'}</span>` : ''}
        ${job.match?.confidence ? `<span>${esc(job.match.confidence)} confidence</span>` : ''}
        ${job.active === false && job.expiredReason ? `<span>${esc(job.expiredReason)}</span>` : ''}
      </div>
    </article>
  `;
}

function renderProgress(run) {
  if (!run) {
    $('#progress-card').classList.add('hidden');
    return;
  }
  const card = $('#progress-card');
  card.classList.remove('hidden');
  const progress = run.progress || {};
  let percent = 0;
  if (run.status === 'completed' || run.status === 'error') percent = 100;
  else if (progress.totalToMatch && progress.stage === 'matching') percent = Math.round(((progress.matched || 0) / Math.max(1, progress.totalToMatch)) * 100);
  else if (progress.totalSources) percent = Math.round(((progress.completedSources || 0) / Math.max(1, progress.totalSources)) * 100);
  else percent = 6;
  $('#progress-stage').textContent = run.status === 'completed' ? 'Search complete' : run.status === 'error' ? 'Search failed' : (progress.stage || 'Searching');
  $('#progress-message').textContent = run.status === 'error' ? (run.error || 'The search failed.') : (progress.message || 'Working…');
  $('#progress-percent').textContent = `${percent}%`;
  const bar = $('#progress-bar');
  bar.style.width = `${percent}%`;
  bar.style.background = run.status === 'error'
    ? 'linear-gradient(90deg, #dc2626, #f87171)'
    : run.status === 'completed' ? 'linear-gradient(90deg, #15803d, #4ade80)' : '';
  const stats = run.stats || {};
  const pieces = [
    `Sources ${progress.completedSources || 0}/${progress.totalSources || 0}`,
    `${stats.rawDiscovered || 0} scanned`,
    `${stats.newJobs || 0} new`,
    `${stats.mergedJobs || 0} merged`,
    `${stats.aiMatched || 0} AI-scored`,
    `${stats.rulesOnly || 0} rules-scored`
  ];
  if (run.ai?.status && run.ai.status !== 'not_configured') pieces.push(`AI: ${run.ai.status}`);
  if (stats.expired) pieces.push(`${stats.expired} expired`);
  if (stats.sourceErrors) pieces.push(`${stats.sourceErrors} source errors`);
  $('#progress-meta').innerHTML = pieces.map((piece) => `<span>${esc(piece)}</span>`).join('');
}

function watchRun(runId) {
  if (!runId || state.watchingRunId === runId) return;
  clearInterval(state.watchTimer);
  state.watchingRunId = runId;
  const tick = async () => {
    try {
      const { run } = await api(`/api/runs/${encodeURIComponent(runId)}`);
      handleRunUpdate(run);
    } catch (error) {
      if (error.status === 404) {
        stopWatching();
      }
    }
  };
  tick();
  state.watchTimer = setInterval(tick, 2200);
}

function stopWatching() {
  clearInterval(state.watchTimer);
  state.watchTimer = null;
  state.watchingRunId = null;
}

function handleRunUpdate(run) {
  if (!run) return;
  state.activeRun = run;
  renderProgress(run);
  updateSearchUI();
  if (run.status === 'completed' || run.status === 'error') {
    if (state.lastCompletedRunId === run.id) return;
    state.lastCompletedRunId = run.id;
    stopWatching();
    const stats = run.stats || {};
    toast(
      run.status === 'completed'
        ? `Search complete: ${stats.newJobs || 0} new, ${stats.mergedJobs || 0} merged, ${stats.aiMatched || 0} AI-scored.`
        : `Search failed: ${run.error || 'unknown error'}`,
      run.status === 'completed' ? 'success' : 'error',
      6500
    );
    refreshAfterRun();
    setTimeout(() => {
      if (state.activeRun?.id === run.id) {
        state.activeRun = null;
        $('#progress-card').classList.add('hidden');
        updateSearchUI();
      }
    }, 12000);
  }
}

async function refreshAfterRun() {
  await loadState();
  await loadJobs(true);
  if (state.page === 'activity') loadRuns();
}

async function startSearch() {
  if (state.activeRun?.status === 'running') {
    toast('A search is already running.', 'info');
    return;
  }
  if (!state.data?.profile) {
    toast('Add a resume before searching.', 'info');
    navigate('profile');
    return;
  }
  const button = $('#search-btn');
  setButtonLoading(button, true, 'Starting…');
  try {
    const result = await api('/api/search', { method: 'POST' });
    state.activeRun = {
      id: result.runId,
      status: 'running',
      progress: { stage: 'starting', message: 'Preparing search…', completedSources: 0, totalSources: 0 },
      stats: {}
    };
    renderProgress(state.activeRun);
    updateSearchUI();
    watchRun(result.runId);
    toast('Search started. You can keep using JobScout while it runs.', 'info');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
    updateSearchUI();
  }
}

function renderProfile(force = false) {
  const profile = state.data?.profile;
  const empty = $('#profile-empty');
  const editor = $('#profile-editor');
  if (!profile) {
    empty.classList.remove('hidden');
    editor.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  editor.classList.remove('hidden');
  if (force) state.profileDirty = false;

  $('#profile-file-name').textContent = profile.resumeFileName || 'Resume on file';
  $('#profile-file-meta').textContent = [
    profile.resumeUploadedAt ? `Uploaded ${formatDate(profile.resumeUploadedAt)}` : 'Upload date unknown',
    `${profile.resumeTextChars || 0} characters extracted`,
    profile.analysis?.method === 'ai' ? `AI-extracted${profile.analysis.model ? ` · ${profile.analysis.model}` : ''}` : 'Extracted locally'
  ].join(' · ');
  const completeness = Math.max(0, Math.min(100, Number(profile.completeness) || 0));
  $('#profile-completeness-bar').style.width = `${completeness}%`;
  $('#profile-completeness-text').textContent = `${completeness}% complete`;

  const note = $('#profile-ai-note');
  if (profile.analysis?.method === 'ai') {
    note.classList.remove('hidden');
    note.textContent = `AI extraction used ${profile.analysis.provider || 'your provider'}${profile.analysis.model ? ` (${profile.analysis.model})` : ''}. Review every field — models can misread dates, titles, or skills.`;
  } else if (profile.analysis?.note) {
    note.classList.remove('hidden');
    note.textContent = profile.analysis.note;
  } else {
    note.classList.add('hidden');
  }

  const form = $('#profile-form');
  const set = (name, value) => {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  };
  set('name', profile.name);
  set('email', profile.email);
  set('phone', profile.phone);
  set('location', profile.location);
  set('headline', profile.headline);
  set('experienceYears', profile.experienceYears ?? '');
  set('experienceLevel', profile.experienceLevel || '');
  set('summary', profile.summary);
  set('skills', (profile.skills || []).join(', '));
  set('suggestedTitles', (profile.suggestedTitles || []).join('\n'));
  set('keywords', (profile.keywords || []).join(', '));
  set('certifications', (profile.certifications || []).join('\n'));
  set('linkedin', profile.links?.linkedin || '');
  set('github', profile.links?.github || '');
  set('otherLinks', (profile.links?.other || []).join('\n'));

  renderRepeater('experience', profile.experience || []);
  renderRepeater('projects', profile.projects || []);
  renderRepeater('education', profile.education || []);

  const analyzeButton = $('#analyze-profile-btn');
  const aiEnabled = Boolean(state.data?.settings?.ai?.enabled && state.data?.settings?.ai?.hasKey);
  analyzeButton.disabled = !aiEnabled;
  analyzeButton.title = aiEnabled ? 'Send the resume to your configured AI provider for a second extraction pass' : 'Configure and enable an AI provider in Settings first';
  $('#profile-save-hint').textContent = state.profileDirty ? 'Unsaved changes.' : 'Changes are saved locally.';
}

const REPEATER_FIELDS = {
  experience: [
    { field: 'title', label: 'Title', placeholder: 'Senior Backend Engineer' },
    { field: 'company', label: 'Company', placeholder: 'Acme' },
    { field: 'start', label: 'Start', placeholder: 'Jan 2022' },
    { field: 'end', label: 'End', placeholder: 'Present' },
    { field: 'description', label: 'Description', type: 'textarea', span: true },
    { field: 'technologies', label: 'Technologies', placeholder: 'Python, AWS', list: true, span: true }
  ],
  projects: [
    { field: 'name', label: 'Project', placeholder: 'Job matching service' },
    { field: 'description', label: 'Description', type: 'textarea', span: true },
    { field: 'technologies', label: 'Technologies', placeholder: 'Node.js, PostgreSQL', list: true, span: true }
  ],
  education: [
    { field: 'degree', label: 'Degree', placeholder: 'B.Tech Computer Science' },
    { field: 'institution', label: 'Institution', placeholder: 'University' },
    { field: 'year', label: 'Year', placeholder: '2020' },
    { field: 'field', label: 'Field', placeholder: 'Computer Science' }
  ]
};

function repeatRow(type, item = {}) {
  const fields = REPEATER_FIELDS[type] || [];
  return `
    <div class="repeat-row" data-row>
      ${fields.map((field) => {
        const value = field.list ? (item[field.field] || []).join(', ') : (item[field.field] || '');
        const attrs = `data-field="${field.field}"${field.list ? ' data-list="true"' : ''}`;
        if (field.type === 'textarea') {
          return `<label class="${field.span ? 'span-2' : ''}">${esc(field.label)}<textarea ${attrs} rows="2" placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea></label>`;
        }
        return `<label class="${field.span ? 'span-2' : ''}">${esc(field.label)}<input ${attrs} value="${esc(value)}" placeholder="${esc(field.placeholder || '')}"></label>`;
      }).join('')}
      <button class="icon-btn remove-row" type="button" data-remove-row aria-label="Remove row">${icon('close')}</button>
    </div>
  `;
}

function renderRepeater(type, items) {
  const container = $(`#${type}-repeater`);
  if (!container) return;
  container.innerHTML = items.length
    ? items.map((item) => repeatRow(type, item)).join('')
    : '<div class="repeat-empty">No entries yet. Add one if it helps explain your experience.</div>';
}

function addRepeaterRow(type) {
  const container = $(`#${type}-repeater`);
  if (!container) return;
  const empty = $('.repeat-empty', container);
  if (empty) empty.remove();
  container.insertAdjacentHTML('beforeend', repeatRow(type, {}));
  const last = container.lastElementChild;
  last?.querySelector('input, textarea')?.focus();
  state.profileDirty = true;
  $('#profile-save-hint').textContent = 'Unsaved changes.';
}

function removeRepeaterRow(button) {
  const row = button.closest('.repeat-row');
  const container = row?.parentElement;
  row?.remove();
  if (container && !$('.repeat-row', container)) {
    container.innerHTML = '<div class="repeat-empty">No entries yet. Add one if it helps explain your experience.</div>';
  }
  state.profileDirty = true;
  $('#profile-save-hint').textContent = 'Unsaved changes.';
}

function collectRepeater(type) {
  return $$(`#${type}-repeater .repeat-row`).map((row) => {
    const item = {};
    for (const input of $$('[data-field]', row)) {
      const key = input.dataset.field;
      item[key] = input.dataset.list === 'true' ? lines(input.value) : input.value.trim();
    }
    return item;
  }).filter((item) => Object.entries(item).some(([key, value]) => key === 'technologies' ? value.length : Boolean(value)));
}

async function saveProfile(event) {
  event.preventDefault();
  const form = $('#profile-form');
  const button = $('#save-profile-btn');
  const payload = {
    name: form.elements.name.value,
    email: form.elements.email.value,
    phone: form.elements.phone.value,
    location: form.elements.location.value,
    headline: form.elements.headline.value,
    experienceYears: form.elements.experienceYears.value,
    experienceLevel: form.elements.experienceLevel.value,
    summary: form.elements.summary.value,
    skills: lines(form.elements.skills.value),
    suggestedTitles: lines(form.elements.suggestedTitles.value),
    keywords: lines(form.elements.keywords.value),
    certifications: lines(form.elements.certifications.value),
    experience: collectRepeater('experience'),
    projects: collectRepeater('projects'),
    education: collectRepeater('education'),
    links: {
      linkedin: form.elements.linkedin.value.trim(),
      github: form.elements.github.value.trim(),
      other: newlineList(form.elements.otherLinks.value)
    }
  };
  setButtonLoading(button, true, 'Saving…');
  try {
    const result = await api('/api/profile', { method: 'PUT', body: { profile: payload } });
    state.data.profile = result.profile;
    state.profileDirty = false;
    renderProfile(true);
    toast('Profile saved locally.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

async function analyzeProfile() {
  if (!state.data?.profile) return;
  if (!state.data?.settings?.ai?.enabled || !state.data?.settings?.ai?.hasKey) {
    toast('Configure and enable an AI provider in Settings first.', 'info');
    navigate('settings');
    return;
  }
  const fullText = state.data.settings.privacy?.sendFullResumeText !== false;
  const ok = await confirmDialog({
    title: 'Analyze with AI?',
    message: fullText
      ? `Your resume text will be sent to ${state.data.settings.ai.provider} (${state.data.settings.ai.model}) for this analysis. No job application or employer contact happens.`
      : `Only your structured profile will be sent to ${state.data.settings.ai.provider} (${state.data.settings.ai.model}). Full resume text stays local.`,
    confirmLabel: 'Analyze',
    danger: false
  });
  if (!ok) return;
  const button = $('#analyze-profile-btn');
  setButtonLoading(button, true, 'Analyzing…');
  try {
    const result = await api('/api/profile/analyze', { method: 'POST' });
    state.data.profile = result.profile;
    state.profileDirty = false;
    renderProfile(true);
    toast(result.sentFullResumeText ? 'AI analysis complete. Review the corrected fields.' : 'AI analysis complete using the structured profile.', 'success');
  } catch (error) {
    toast(`AI analysis failed: ${error.message}`, 'error', 6500);
  } finally {
    setButtonLoading(button, false);
    renderProfile(true);
  }
}

async function uploadResume(file) {
  if (!file || state.uploading) return;
  if (file.size > 10 * 1024 * 1024) {
    toast('Resume is larger than 10 MB.', 'error');
    return;
  }
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
    toast('Upload a PDF or DOCX resume.', 'error');
    return;
  }
  if (state.data?.profile) {
    const ok = await confirmDialog({
      title: 'Replace the current resume?',
      message: 'The current profile and its extracted fields will be replaced. Jobs and their saved/applied status stay in place.',
      confirmLabel: 'Replace resume'
    });
    if (!ok) return;
  }
  state.uploading = true;
  toast('Uploading and extracting locally…', 'info', 6000);
  try {
    const formData = new FormData();
    formData.append('resume', file, file.name);
    const response = await fetch('/api/resume/upload', { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
    state.data.profile = data.profile;
    state.profileDirty = false;
    renderProfile(true);
    navigate('profile');
    const warning = data.warnings?.[0] ? ` ${data.warnings[0]}` : '';
    toast(`Resume parsed locally. Review the fields below.${warning}`, 'success', 6500);
    if (data.ai?.available) {
      setTimeout(() => toast('AI is configured. Use “Analyze with AI” if you want a second extraction pass.', 'info', 6000), 800);
    }
  } catch (error) {
    toast(error.message, 'error', 6500);
  } finally {
    state.uploading = false;
    const input = $('#resume-input');
    if (input) input.value = '';
  }
}

function renderPreferences(force = false) {
  if (!state.data) return;
  if (force) state.prefsDirty = false;
  const prefs = state.data.preferences || {};
  const form = $('#preferences-form');
  const set = (name, value) => {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  };
  set('titles', (prefs.titles || []).join('\n'));
  set('locations', (prefs.locations || []).join('\n'));
  set('countries', (prefs.countries || []).join('\n'));
  set('technologies', (prefs.technologies || []).join('\n'));
  set('employmentTypes', (prefs.employmentTypes || []).join('\n'));
  set('industries', (prefs.industries || []).join('\n'));
  set('includeCompanies', (prefs.includeCompanies || []).join('\n'));
  set('excludeCompanies', (prefs.excludeCompanies || []).join('\n'));
  set('minSalary', prefs.minSalary ?? '');
  set('currency', prefs.currency || 'INR');
  set('maxResults', prefs.maxResults ?? 150);
  set('maxAgeDays', prefs.maxAgeDays ?? 45);
  set('dailyTime', prefs.dailyTime || '09:00');
  set('dailyTimezone', prefs.dailyTimezone || 'Asia/Kolkata');
  form.elements.dailyEnabled.checked = Boolean(prefs.dailyEnabled);

  for (const checkbox of $$('input[name="workMode"]', form)) {
    checkbox.checked = (prefs.workModes || []).includes(checkbox.value);
  }
  for (const checkbox of $$('input[name="experienceLevel"]', form)) {
    checkbox.checked = (prefs.experienceLevels || []).includes(checkbox.value);
  }
  renderSourceConfig(prefs);
}

function renderSourceConfig(prefs) {
  const container = $('#source-config');
  if (!container) return;
  const sources = state.data.sources || [];
  const boards = prefs.boards || {};
  const enabledSources = new Set(prefs.enabledSources || []);
  const adzuna = prefs.adzuna || {};

  container.innerHTML = sources.map((source) => {
    let fields = '';
    if (source.configType === 'tokens') {
      fields = `<label class="span-2">Board tokens <span class="hint">one public board token per line</span><textarea id="board-${esc(source.id)}" data-board="${esc(source.id)}" rows="3" placeholder="stripe&#10;vercel">${esc((boards[source.configKey] || []).join('\n'))}</textarea></label>`;
    } else if (source.configType === 'workday') {
      const rows = (boards.workday || []).map((item) => [item.tenant, item.wd, item.site, item.label].filter(Boolean).join(' | ')).join('\n');
      fields = `<label class="span-2">Workday tenants <span class="hint">tenant | wd | site | label — one per line</span><textarea id="board-workday" rows="3" placeholder="salesforce | wd12 | External_Career_Site | Salesforce">${esc(rows)}</textarea></label>`;
    } else if (source.configType === 'urls') {
      fields = `<label class="span-2">Career page URLs <span class="hint">JSON-LD JobPosting pages only, one per line</span><textarea id="board-custom" rows="3" placeholder="https://example.com/careers">${esc((boards.custom || []).join('\n'))}</textarea></label>`;
    } else if (source.configType === 'adzuna') {
      fields = `
        <label>Adzuna app ID<input id="adzuna-app-id" value="${esc(adzuna.appId || '')}" autocomplete="off"></label>
        <label>Country code<input id="adzuna-country" value="${esc(adzuna.country || 'in')}" maxlength="2" placeholder="in"></label>
        <label>Adzuna app key <span class="hint">${adzuna.hasAppKey ? 'a key is saved' : 'free key required'}</span><input id="adzuna-app-key" type="password" autocomplete="off" placeholder="${adzuna.hasAppKey ? 'Saved — leave blank to keep' : 'Paste app key'}"></label>
        <label class="check standalone"><input type="checkbox" id="adzuna-clear-key"> Remove saved Adzuna key</label>
      `;
    }
    const status = source.needsConfig && !source.configured ? badge('Needs setup', 'warn') : source.enabled ? badge('Enabled', 'good') : badge('Disabled');
    return `
      <div class="source-config-card" data-source="${esc(source.id)}">
        <div class="source-config-head">
          <label class="check"><input type="checkbox" name="enabledSources" value="${esc(source.id)}" ${enabledSources.has(source.id) ? 'checked' : ''}> <strong>${esc(source.label)}</strong></label>
          ${status}
        </div>
        <p class="source-notes">${esc(source.notes || '')}</p>
        ${fields ? `<div class="form-grid two source-fields">${fields}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function savePreferences(event) {
  event.preventDefault();
  const form = $('#preferences-form');
  const button = form.querySelector('button[type="submit"]');
  const tokenSources = (state.data.sources || []).filter((source) => source.configType === 'tokens');
  const boards = {};
  for (const source of tokenSources) {
    const element = $(`#board-${source.id}`);
    boards[source.id] = element ? newlineList(element.value) : [];
  }
  const workdayElement = $('#board-workday');
  boards.workday = workdayElement
    ? newlineList(workdayElement.value).map((line) => {
      const [tenant, wd, site, label] = line.split('|').map((part) => part.trim());
      return { tenant, wd, site, label };
    }).filter((item) => item.tenant && item.wd && item.site)
    : [];
  const customElement = $('#board-custom');
  boards.custom = customElement ? newlineList(customElement.value) : [];

  const payload = {
    titles: lines(form.elements.titles.value),
    locations: lines(form.elements.locations.value),
    countries: lines(form.elements.countries.value),
    workModes: $$('input[name="workMode"]:checked', form).map((input) => input.value),
    experienceLevels: $$('input[name="experienceLevel"]:checked', form).map((input) => input.value),
    employmentTypes: lines(form.elements.employmentTypes.value),
    technologies: lines(form.elements.technologies.value),
    industries: lines(form.elements.industries.value),
    includeCompanies: lines(form.elements.includeCompanies.value),
    excludeCompanies: lines(form.elements.excludeCompanies.value),
    minSalary: form.elements.minSalary.value,
    currency: form.elements.currency.value,
    maxResults: form.elements.maxResults.value,
    maxAgeDays: form.elements.maxAgeDays.value,
    dailyEnabled: form.elements.dailyEnabled.checked,
    dailyTime: form.elements.dailyTime.value,
    dailyTimezone: form.elements.dailyTimezone.value,
    enabledSources: $$('input[name="enabledSources"]:checked', form).map((input) => input.value),
    boards,
    adzuna: {
      appId: $('#adzuna-app-id')?.value || '',
      country: $('#adzuna-country')?.value || 'in'
    }
  };
  setButtonLoading(button, true, 'Saving…');
  try {
    const result = await api('/api/preferences', {
      method: 'PUT',
      body: {
        preferences: payload,
        adzunaAppKey: $('#adzuna-app-key')?.value || '',
        clearAdzunaKey: Boolean($('#adzuna-clear-key')?.checked)
      }
    });
    state.prefsDirty = false;
    applyState(result, { forceForms: true });
    toast('Preferences saved.', 'success');
  } catch (error) {
    toast(error.message, 'error', 6000);
  } finally {
    setButtonLoading(button, false);
  }
}

function renderSources() {
  const grid = $('#sources-grid');
  if (!grid || !state.data) return;
  const sources = state.data.sources || [];
  grid.innerHTML = sources.map((source) => {
    const last = source.lastRun;
    const status = source.needsConfig && !source.configured
      ? badge('Needs setup', 'warn')
      : source.enabled ? badge('Enabled', 'good') : badge('Disabled');
    const lastText = last
      ? `${last.status || 'unknown'} · ${last.jobs ?? 0} jobs${last.durationMs ? ` · ${durationText(last.durationMs)}` : ''}`
      : 'Not run yet';
    return `
      <article class="source-card">
        <div class="source-head">
          <div><h3>${esc(source.label)}</h3><div class="source-group">${esc(source.group || '')} · ${esc(source.method || '')}</div></div>
          ${status}
        </div>
        <p class="source-coverage">${esc(source.coverage || '')}</p>
        <p class="source-notes">${esc(source.notes || '')}</p>
        <div class="source-foot">
          <span class="source-last">Last run: ${esc(lastText)}</span>
          ${source.docsUrl ? `<a href="${safeUrl(source.docsUrl)}" target="_blank" rel="noopener noreferrer">Docs ${icon('external')}</a>` : ''}
        </div>
      </article>
    `;
  }).join('');

  const manual = $('#manual-links');
  const data = state.data.manual || { titles: [], location: '', sources: [] };
  manual.innerHTML = `
    <div class="manual-card" style="grid-column:1/-1">
      <h3>Search terms</h3>
      <p>${esc((data.titles || []).join(' · ') || 'Software Engineer')} — ${esc(data.location || 'India')}</p>
      <p>These links open the platform in a new tab. JobScout does not fetch, scrape, or auto-apply on these sites.</p>
    </div>
    ${(data.sources || []).map((source) => `
      <article class="manual-card">
        <h3>${esc(source.label)}</h3>
        <p>${esc(source.reason || '')}</p>
        <a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">Open search ${icon('external')}</a>
      </article>
    `).join('')}
  `;
}

function renderSettings(force = false) {
  if (!state.data) return;
  if (force) state.settingsDirty = false;
  const settings = state.data.settings || {};
  const ai = settings.ai || {};
  const providers = settings.providers || [];
  const select = $('#ai-provider');
  select.innerHTML = providers.map((provider) => `<option value="${esc(provider.id)}">${esc(provider.label)}</option>`).join('');
  select.value = ai.provider || 'gemini';
  $('#ai-model').value = ai.model || '';
  $('#ai-key').value = '';
  $('#ai-key').placeholder = ai.hasKey ? 'Saved key — leave blank to keep' : 'Paste a free-tier key';
  $('#ai-key-hint').textContent = ai.hasKey
    ? 'A key is saved and encrypted. It is never returned to the browser or written to logs.'
    : 'Keys are encrypted at rest and never returned to the browser.';
  $('#ai-base-url').value = ai.baseUrl || '';
  $('#ai-enabled').checked = Boolean(ai.enabled);
  $('#ai-clear-key').checked = false;
  $('#ai-key').disabled = false;
  $('#privacy-full-resume').checked = settings.privacy?.sendFullResumeText !== false;
  $('#privacy-keep-text').checked = settings.privacy?.keepResumeText !== false;
  renderProviderInfo(select.value);
}

function renderProviderInfo(providerId) {
  const settings = state.data?.settings || {};
  const ai = settings.ai || {};
  const provider = (settings.providers || []).find((item) => item.id === providerId) || {};
  const pieces = [
    `<div><strong>${esc(provider.label || providerId || 'Provider')}</strong> · default model <code>${esc(provider.defaultModel || '—')}</code></div>`,
    provider.freeNote ? `<div>${esc(provider.freeNote)}</div>` : '',
    `<div>Saved key: ${ai.hasKey ? 'yes, encrypted' : 'none'}${ai.model ? ` · active model ${esc(ai.model)}` : ''}</div>`,
    ai.lastSuccessAt ? `<div>Last success: ${esc(formatDateTime(ai.lastSuccessAt))}</div>` : '',
    ai.lastError ? `<div>Last error: ${esc(ai.lastError)}</div>` : '',
    state.data?.coolingDownUntil ? `<div>Cooling down until ${esc(formatDateTime(state.data.coolingDownUntil))} after a rate limit or quota error.</div>` : '',
    `<div>Requests: ${esc(ai.totalRequests ?? 0)} · tokens in/out: ${esc(ai.totalInputTokens ?? 0)}/${esc(ai.totalOutputTokens ?? 0)}</div>`,
    provider.keyUrl ? `<div><a href="${safeUrl(provider.keyUrl)}" target="_blank" rel="noopener noreferrer">Get a free key ${icon('external')}</a> · <a href="${safeUrl(provider.docsUrl || provider.keyUrl)}" target="_blank" rel="noopener noreferrer">Rate limits ${icon('external')}</a></div>` : ''
  ];
  $('#provider-info').innerHTML = pieces.filter(Boolean).join('');
}

async function saveAiSettings(event) {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  const body = {
    ai: {
      provider: $('#ai-provider').value,
      model: $('#ai-model').value.trim(),
      apiKey: $('#ai-key').value.trim(),
      baseUrl: $('#ai-base-url').value.trim(),
      enabled: $('#ai-enabled').checked,
      clearKey: $('#ai-clear-key').checked
    },
    privacy: {
      sendFullResumeText: $('#privacy-full-resume').checked,
      keepResumeText: $('#privacy-keep-text').checked
    }
  };
  setButtonLoading(button, true, 'Saving…');
  try {
    const result = await api('/api/settings', { method: 'PUT', body });
    state.data.settings = result.settings;
    state.data.coolingDownUntil = result.coolingDownUntil;
    state.settingsDirty = false;
    renderSettings(true);
    updateSidebarAI();
    toast('AI and privacy settings saved.', 'success');
    await loadState();
  } catch (error) {
    toast(error.message, 'error', 6500);
  } finally {
    setButtonLoading(button, false);
  }
}

async function savePrivacy() {
  const button = $('#save-privacy-btn');
  setButtonLoading(button, true, 'Saving…');
  try {
    const result = await api('/api/settings', {
      method: 'PUT',
      body: {
        privacy: {
          sendFullResumeText: $('#privacy-full-resume').checked,
          keepResumeText: $('#privacy-keep-text').checked
        }
      }
    });
    state.data.settings = result.settings;
    state.settingsDirty = false;
    renderSettings(true);
    toast('Privacy settings saved.', 'success');
    await loadState();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

async function testAi() {
  const button = $('#test-ai-btn');
  const resultBox = $('#ai-test-result');
  setButtonLoading(button, true, 'Testing…');
  resultBox.classList.add('hidden');
  try {
    const result = await api('/api/settings/ai/test', {
      method: 'POST',
      body: {
        provider: $('#ai-provider').value,
        model: $('#ai-model').value.trim(),
        baseUrl: $('#ai-base-url').value.trim(),
        apiKey: $('#ai-key').value.trim()
      }
    });
    resultBox.textContent = `Connection succeeded in ${result.latencyMs} ms using ${result.model}. ${result.note || ''}`;
    resultBox.className = 'ai-result';
    resultBox.classList.remove('hidden');
    toast('AI connection succeeded.', 'success');
    await loadState();
  } catch (error) {
    resultBox.textContent = `Connection failed: ${error.message}`;
    resultBox.className = 'ai-result error';
    resultBox.classList.remove('hidden');
    toast('AI connection failed.', 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

async function loadAiModels() {
  const button = $('#load-models-btn');
  setButtonLoading(button, true, 'Loading…');
  try {
    const result = await api('/api/settings/ai/models', {
      method: 'POST',
      body: {
        provider: $('#ai-provider').value,
        baseUrl: $('#ai-base-url').value.trim(),
        apiKey: $('#ai-key').value.trim()
      }
    });
    const list = $('#ai-models');
    list.innerHTML = (result.models || []).map((model) => `<option value="${esc(model.id)}">${esc(model.label || model.id)}</option>`).join('');
    toast(`Loaded ${result.models?.length || 0} models.`, 'success');
  } catch (error) {
    toast(`Could not load models: ${error.message}`, 'error', 6000);
  } finally {
    setButtonLoading(button, false);
  }
}

async function loadRuns() {
  try {
    const result = await api('/api/runs');
    state.runs = result.runs || [];
    renderRuns();
  } catch (error) {
    toast(`Could not load activity: ${error.message}`, 'error');
  }
}

function renderRuns() {
  const container = $('#runs-list');
  if (!container) return;
  if (!state.runs.length) {
    container.innerHTML = '<div class="card run-empty">No search runs yet. Run a search from the dashboard.</div>';
    return;
  }
  container.innerHTML = state.runs.map((run) => {
    const stats = run.stats || {};
    const statusClass = run.status === 'completed' ? 'good' : run.status === 'error' ? 'danger' : run.status === 'running' ? 'warn' : '';
    const sourceStats = Object.entries(run.sourceStats || {});
    const errors = run.sourceErrors || [];
    return `
      <article class="run-card">
        <div class="run-head">
          <div>
            <h3>${run.reason === 'scheduled' ? 'Scheduled search' : 'Manual search'} ${badge(run.status || 'unknown', statusClass)}</h3>
            <div class="run-time">${esc(formatDateTime(run.startedAt))}${run.durationMs ? ` · ${esc(durationText(run.durationMs))}` : ''}${run.finishedAt ? ` · finished ${esc(relativeTime(run.finishedAt))}` : ''}</div>
          </div>
          ${run.ai?.model ? badge(`AI: ${run.ai.model}`, 'ai') : badge(`AI: ${run.ai?.status || 'not used'}`, 'rules')}
        </div>
        <div class="run-stats">
          <span class="run-stat"><strong>${stats.rawDiscovered || 0}</strong> scanned</span>
          <span class="run-stat"><strong>${stats.newJobs || 0}</strong> new</span>
          <span class="run-stat"><strong>${stats.mergedJobs || 0}</strong> merged</span>
          <span class="run-stat"><strong>${stats.aiMatched || 0}</strong> AI</span>
          <span class="run-stat"><strong>${stats.rulesOnly || 0}</strong> rules</span>
          <span class="run-stat"><strong>${stats.expired || 0}</strong> expired</span>
          <span class="run-stat"><strong>${stats.verificationChecked || 0}</strong> verified</span>
        </div>
        ${run.progress?.message ? `<p class="source-notes">${esc(run.progress.message)}</p>` : ''}
        ${run.error ? `<p class="source-notes" style="color:var(--danger)">${esc(run.error)}</p>` : ''}
        ${sourceStats.length ? `<details class="run-errors"><summary>Source results (${sourceStats.length})</summary><ul class="error-list">${sourceStats.map(([source, stat]) => `<li><strong>${esc(source)}</strong> · ${esc(stat.status || 'unknown')} · ${esc(stat.jobs ?? 0)} jobs · ${esc(stat.scanned ?? 0)} scanned${stat.message ? ` · ${esc(stat.message)}` : ''}</li>`).join('')}</ul></details>` : ''}
        ${errors.length ? `<details class="run-errors"><summary>Source errors (${errors.length})</summary><ul class="error-list">${errors.map((error) => `<li><strong>${esc(error.source || 'source')}</strong>${error.board ? ` / ${esc(error.board)}` : ''} · ${esc(error.message || '')}</li>`).join('')}</ul></details>` : ''}
      </article>
    `;
  }).join('');
}

async function updateJobStatus(id, status, { notes } = {}) {
  const result = await api(`/api/jobs/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: notes == null ? { status } : { status, notes }
  });
  if (result.stats) {
    state.data.stats = result.stats;
    renderStats(result.stats);
  }
  const index = state.jobs.findIndex((job) => job.id === id);
  if (index >= 0) state.jobs[index] = result.job;
  if (state.currentJob?.id === id) state.currentJob = result.job;
  return result;
}

async function openJob(id) {
  state.currentJob = null;
  $('#job-modal-body').innerHTML = '<div class="modal-loading"><span class="spinner dark"></span> Loading job…</div>';
  $('#job-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  try {
    const result = await api(`/api/jobs/${encodeURIComponent(id)}`);
    state.currentJob = result.job;
    renderJobModal(result.job);
  } catch (error) {
    $('#job-modal-body').innerHTML = `<div class="modal-loading">Could not load this job: ${esc(error.message)}</div>`;
  }
}

function closeJobModal() {
  $('#job-modal').classList.add('hidden');
  if ($('#confirm-modal').classList.contains('hidden')) document.body.classList.remove('modal-open');
  state.currentJob = null;
}

function renderJobModal(job) {
  const match = job.match || {};
  const score = clampScore(match.score);
  const salary = formatSalary(job);
  const sourceRefs = (job.sources || []).map((source) => `
    <div class="source-ref">
      <span>${esc(source.sourceLabel || source.source || 'Source')}${source.requisitionId ? ` · req ${esc(source.requisitionId)}` : ''}</span>
      <a href="${safeUrl(source.url || job.url)}" target="_blank" rel="noopener noreferrer">Open ${icon('external')}</a>
    </div>
  `).join('');
  const breakdown = Object.entries(match.breakdown || {}).map(([key, value]) => {
    const max = Number(value?.max) || 1;
    const got = Number(value?.score) || 0;
    const percent = Math.max(0, Math.min(100, (got / max) * 100));
    return `
      <div class="breakdown-row">
        <span>${esc(key)}</span>
        <div class="breakdown-track"><div class="breakdown-fill" style="width:${percent}%"></div></div>
        <strong>${Math.round(got * 10) / 10}/${max}</strong>
      </div>
    `;
  }).join('');
  const matchedRequired = (match.matchedRequired || []).map((skill) => `<span class="chip">${esc(skill)}</span>`).join('');
  const missingRequired = (match.missingRequired || []).map((skill) => `<span class="chip missing">${esc(skill)}</span>`).join('');
  const matchedPreferred = (match.matchedPreferred || []).map((skill) => `<span class="chip pref">${esc(skill)}</span>`).join('');
  const missingPreferred = (match.missingPreferred || []).map((skill) => `<span class="chip more">${esc(skill)}</span>`).join('');
  const status = job.status || 'new';

  $('#job-modal-body').innerHTML = `
    <div class="modal-head">
      <h2 id="job-modal-title">${esc(job.title)}</h2>
      <div class="modal-company">${esc(job.company)} · ${esc(job.location || 'Location not specified')} · ${esc(workModeLabel(job.workMode))}</div>
      <div class="job-meta">
        ${badge(job.sourceLabel || job.source || 'Source', 'source')}
        ${badge(statusLabel(status), status === 'applied' ? 'good' : status === 'dismissed' ? 'warn' : '')}
        ${job.active === false ? badge('Expired', 'danger') : ''}
        ${badge(match.method === 'ai' ? 'AI match' : 'Rules match', match.method === 'ai' ? 'ai' : 'rules')}
        ${job.postedAt ? badge(`Posted ${relativeTime(job.postedAt)}`) : ''}
        ${salary ? badge(salary) : ''}
        ${job.employmentType ? badge(job.employmentType) : ''}
        ${job.experienceRequired ? badge(job.experienceRequired) : ''}
      </div>
    </div>
    <div class="modal-score-row">
      <div class="score-ring ${scoreClass(score)}" style="--score:${score}"><span>${score}</span><small>match</small></div>
      <div class="modal-score-copy">
        <strong>${esc(match.recommendation === 'apply' ? 'Worth applying' : match.recommendation === 'consider' ? 'Consider applying' : 'Skip this one')} · ${esc(match.confidence || 'unknown')} confidence</strong>
        <p>${esc(match.verdict || '')}</p>
        <p>${esc(match.why || '')}</p>
      </div>
    </div>
    ${matchedRequired || missingRequired || matchedPreferred || missingPreferred ? `
      <div class="modal-section">
        <h3>Skills evidence</h3>
        <div class="skill-row">${matchedRequired}${missingRequired}${matchedPreferred}${missingPreferred}</div>
        ${match.missingRequired?.length ? `<p class="privacy-note" style="margin-top:8px">Red chips are explicitly required by the posting and were not found in your profile.</p>` : ''}
      </div>
    ` : ''}
    <div class="modal-section">
      <h3>Assessment</h3>
      <p>${esc(match.experienceAssessment || 'Experience fit was not assessed.')}</p>
      <p style="margin-top:5px">${esc(match.locationAssessment || 'Location eligibility was not assessed.')}</p>
      <p style="margin-top:5px">${esc(match.educationAssessment || 'No explicit education requirement detected.')}</p>
      ${match.aiNotes ? `<p class="privacy-note" style="margin-top:7px">AI note: ${esc(match.aiNotes)}</p>` : ''}
    </div>
    ${breakdown ? `<div class="modal-section"><h3>Score breakdown</h3><div class="breakdown">${breakdown}</div></div>` : ''}
    <div class="modal-section">
      <h3>Posting</h3>
      <div class="description">${esc(job.description || 'No description was returned by the source. Open the original posting for details.')}</div>
    </div>
    <div class="modal-section">
      <h3>Sources &amp; verification</h3>
      <div class="source-refs">
        ${sourceRefs || `<div class="source-ref"><span>Original source</span><a href="${safeUrl(job.url)}" target="_blank" rel="noopener noreferrer">Open ${icon('external')}</a></div>`}
      </div>
      <p class="privacy-note" style="margin-top:8px">First seen ${esc(formatDateTime(job.firstSeenAt))} · Last verified ${esc(formatDateTime(job.lastVerifiedAt))}${job.requisitionId ? ` · Requisition ${esc(job.requisitionId)}` : ''}</p>
      ${job.attribution ? `<p class="privacy-note">${esc(job.attribution)}</p>` : ''}
    </div>
    <div class="modal-section">
      <h3>Your notes</h3>
      <textarea class="notes-area" id="job-notes" placeholder="Why this role interests you, follow-ups, referral contacts…">${esc(job.notes || '')}</textarea>
      <button class="btn ghost small" type="button" data-modal-action="save-notes" data-id="${esc(job.id)}">Save notes</button>
    </div>
    <div class="modal-action-bar">
      <button class="btn ${status === 'saved' ? 'ghost' : 'primary'}" type="button" data-modal-action="save" data-id="${esc(job.id)}" data-status="${esc(status)}">${status === 'saved' ? 'Unsave' : 'Save job'}</button>
      <button class="btn ghost" type="button" data-modal-action="applied" data-id="${esc(job.id)}" data-status="${esc(status)}">${status === 'applied' ? 'Applied ✓' : 'Mark applied'}</button>
      <button class="btn ghost" type="button" data-modal-action="dismiss" data-id="${esc(job.id)}">Dismiss</button>
      <button class="btn ghost" type="button" data-modal-action="verify" data-id="${esc(job.id)}">${icon('refresh')} Recheck listing</button>
      <span class="spacer"></span>
      <a class="btn ghost" href="${safeUrl(job.url)}" target="_blank" rel="noopener noreferrer">Open original ${icon('external')}</a>
    </div>
  `;
}

async function handleModalAction(action, id) {
  const job = state.currentJob;
  if (!job || job.id !== id) return;
  try {
    if (action === 'save') {
      const next = job.status === 'saved' ? 'new' : 'saved';
      const result = await updateJobStatus(id, next);
      renderJobModal(result.job);
      await loadJobs(true);
      toast(next === 'saved' ? 'Job saved.' : 'Job moved back to new.', 'success');
    } else if (action === 'applied') {
      const next = job.status === 'applied' ? 'new' : 'applied';
      const result = await updateJobStatus(id, next);
      renderJobModal(result.job);
      await loadJobs(true);
      toast(next === 'applied' ? 'Marked applied. JobScout does not submit anything.' : 'Application status cleared.', 'success');
    } else if (action === 'dismiss') {
      const result = await updateJobStatus(id, 'dismissed');
      renderJobModal(result.job);
      await loadJobs(true);
      toast('Job dismissed and hidden from the active list.', 'success');
    } else if (action === 'save-notes') {
      const notes = $('#job-notes')?.value || '';
      const result = await updateJobStatus(id, job.status || 'new', { notes });
      state.currentJob = result.job;
      toast('Notes saved locally.', 'success');
    } else if (action === 'verify') {
      const button = $(`[data-modal-action="verify"][data-id="${cssEscape(id)}"]`);
      setButtonLoading(button, true, 'Checking…');
      try {
        const result = await api(`/api/jobs/${encodeURIComponent(id)}/verify`, { method: 'POST' });
        state.currentJob = result.job;
        renderJobModal(result.job);
        await loadJobs(true);
        if (result.verification.expired) toast('The posting appears expired and is now marked inactive.', 'error', 6000);
        else if (result.verification.skipped) toast(`Could not verify: ${result.verification.error}`, 'info', 6000);
        else toast('Listing rechecked successfully.', 'success');
      } finally {
        setButtonLoading(button, false);
      }
    }
  } catch (error) {
    toast(error.message, 'error', 6000);
  }
}

async function deleteResume({ everything = false } = {}) {
  const ok = await confirmDialog({
    title: everything ? 'Delete all JobScout data?' : 'Delete resume and profile?',
    message: everything
      ? 'This removes your profile, jobs, search history, preferences, and encrypted API keys. It cannot be undone.'
      : 'This removes your resume text and profile fields. Jobs and search history stay, but matches will be stale until you add a resume again.',
    confirmLabel: everything ? 'Delete everything' : 'Delete resume'
  });
  if (!ok) return;
  try {
    if (everything) {
      const result = await api('/api/privacy/delete', { method: 'POST', body: { scope: 'everything' } });
      state.profileDirty = false;
      state.prefsDirty = false;
      state.settingsDirty = false;
      state.activeRun = null;
      stopWatching();
      applyState(result, { forceForms: true });
      navigate('dashboard');
      await loadJobs(true);
      toast('All local JobScout data was deleted.', 'success');
    } else {
      await api('/api/profile', { method: 'DELETE' });
      state.data.profile = null;
      state.profileDirty = false;
      renderProfile(true);
      renderOnboarding();
      updateSearchUI();
      await loadJobs(true);
      toast('Resume and profile deleted.', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function navigate(page, load = true) {
  if (!PAGE_META[page]) page = 'dashboard';
  state.page = page;
  for (const button of $$('.nav-item')) button.classList.toggle('active', button.dataset.page === page);
  for (const section of $$('.page')) section.classList.toggle('active', section.id === `page-${page}`);
  $('#page-title').textContent = PAGE_META[page].title;
  $('#page-subtitle').textContent = PAGE_META[page].subtitle;
  $('#sidebar').classList.remove('open');
  if (page === 'dashboard' && load) loadJobs(true);
  if (page === 'activity') loadRuns();
  if (page === 'profile' && state.data?.profile && !state.profileDirty) renderProfile(false);
  if (page === 'preferences' && !state.prefsDirty) renderPreferences(false);
  if (page === 'settings' && !state.settingsDirty) renderSettings(false);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function connectEvents() {
  if (!window.EventSource) return;
  const source = new EventSource('/api/events');
  source.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'hello' && message.activeRun?.status === 'running') {
        handleRunUpdate(message.activeRun);
        watchRun(message.activeRun.id);
      } else if (message.type === 'run' && message.run) {
        handleRunUpdate(message.run);
      } else if (message.type === 'run-error') {
        toast(`Search error: ${message.error || 'unknown error'}`, 'error', 6000);
      }
    } catch {
      // Ignore malformed SSE frames.
    }
  };
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-page]');
    if (nav) {
      navigate(nav.dataset.page);
      return;
    }
    const close = event.target.closest('[data-close-modal]');
    if (close) {
      if (close.dataset.closeModal === 'job') closeJobModal();
      else closeConfirm(false);
      return;
    }
    const add = event.target.closest('[data-add]');
    if (add) {
      addRepeaterRow(add.dataset.add);
      return;
    }
    const remove = event.target.closest('[data-remove-row]');
    if (remove) {
      removeRepeaterRow(remove);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      const id = action.dataset.id;
      if (action.dataset.action === 'go-profile') navigate('profile');
      else if (action.dataset.action === 'go-preferences') navigate('preferences');
      else if (action.dataset.action === 'search') startSearch();
      else if (action.dataset.action === 'open-job' && id) openJob(id);
      else if (action.dataset.action === 'toggle-save' && id) {
        updateJobStatus(id, action.dataset.status === 'saved' ? 'new' : 'saved')
          .then(async (result) => {
            toast(result.job.status === 'saved' ? 'Job saved.' : 'Job moved back to new.', 'success');
            await loadJobs(true);
          })
          .catch((error) => toast(error.message, 'error'));
      } else if (action.dataset.action === 'mark-applied' && id) {
        updateJobStatus(id, action.dataset.status === 'applied' ? 'new' : 'applied')
          .then(async (result) => {
            toast(result.job.status === 'applied' ? 'Marked applied. JobScout does not submit anything.' : 'Application status cleared.', 'success');
            await loadJobs(true);
          })
          .catch((error) => toast(error.message, 'error'));
      } else if (action.dataset.action === 'dismiss' && id) {
        updateJobStatus(id, 'dismissed')
          .then(async () => {
            toast('Job dismissed.', 'success');
            await loadJobs(true);
          })
          .catch((error) => toast(error.message, 'error'));
      }
      return;
    }
    const modalAction = event.target.closest('[data-modal-action]');
    if (modalAction) {
      handleModalAction(modalAction.dataset.modalAction, modalAction.dataset.id);
    }
  });

  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#search-btn').addEventListener('click', startSearch);
  $('#refresh-jobs').addEventListener('click', () => loadJobs(true));
  $('#load-more').addEventListener('click', () => {
    if (state.loadingJobs) return;
    state.offset = state.jobs.length;
    loadJobs(false);
  });
  $('#refresh-runs').addEventListener('click', loadRuns);
  $('#clear-runs').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear search history?', message: 'Run history and source error logs will be removed. Jobs and saved statuses stay.', confirmLabel: 'Clear history' });
    if (!ok) return;
    try {
      await api('/api/runs', { method: 'DELETE' });
      state.runs = [];
      renderRuns();
      toast('Search history cleared.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  let filterTimer = null;
  const applyFilters = () => {
    state.filters.q = $('#filter-q').value.trim();
    state.filters.status = $('#filter-status').value;
    state.filters.source = $('#filter-source').value;
    state.filters.workMode = $('#filter-mode').value;
    state.filters.minScore = $('#filter-score').value;
    state.filters.sort = $('#filter-sort').value;
    state.filters.includeExpired = $('#filter-expired').checked;
    loadJobs(true);
  };
  $('#filter-q').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilters, 260);
  });
  for (const id of ['filter-status', 'filter-source', 'filter-mode', 'filter-score', 'filter-sort', 'filter-expired']) {
    $(`#${id}`).addEventListener('change', applyFilters);
  }

  $('#profile-form').addEventListener('submit', saveProfile);
  $('#profile-form').addEventListener('input', () => {
    state.profileDirty = true;
    $('#profile-save-hint').textContent = 'Unsaved changes.';
  });
  $('#profile-form').addEventListener('change', () => {
    state.profileDirty = true;
    $('#profile-save-hint').textContent = 'Unsaved changes.';
  });
  $('#analyze-profile-btn').addEventListener('click', analyzeProfile);
  $('#delete-resume-btn').addEventListener('click', () => deleteResume());
  $('#delete-resume-settings').addEventListener('click', () => deleteResume());
  $('#delete-everything').addEventListener('click', () => deleteResume({ everything: true }));
  $('#replace-resume-btn').addEventListener('click', () => $('#resume-input').click());
  $('#profile-upload-btn').addEventListener('click', () => $('#resume-input').click());
  $('#resume-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) uploadResume(file);
  });
  const dropzone = $('#profile-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadResume(file);
    });
  }

  $('#preferences-form').addEventListener('submit', savePreferences);
  $('#preferences-form').addEventListener('input', () => { state.prefsDirty = true; });
  $('#preferences-form').addEventListener('change', () => { state.prefsDirty = true; });

  $('#ai-form').addEventListener('submit', saveAiSettings);
  $('#ai-form').addEventListener('input', () => { state.settingsDirty = true; });
  $('#ai-form').addEventListener('change', () => { state.settingsDirty = true; });
  $('#ai-provider').addEventListener('change', () => {
    const provider = (state.data?.settings?.providers || []).find((item) => item.id === $('#ai-provider').value);
    $('#ai-model').value = provider?.defaultModel || '';
    $('#ai-key').value = '';
    $('#ai-key').placeholder = 'Enter a key for the new provider';
    $('#ai-key-hint').textContent = 'Changing providers clears the old key on save. Enter a key for the new provider.';
    renderProviderInfo($('#ai-provider').value);
    state.settingsDirty = true;
  });
  $('#ai-clear-key').addEventListener('change', () => {
    $('#ai-key').disabled = $('#ai-clear-key').checked;
    if ($('#ai-clear-key').checked) $('#ai-key').value = '';
  });
  $('#test-ai-btn').addEventListener('click', testAi);
  $('#load-models-btn').addEventListener('click', loadAiModels);
  $('#save-privacy-btn').addEventListener('click', savePrivacy);
  for (const id of ['privacy-full-resume', 'privacy-keep-text']) {
    $(`#${id}`).addEventListener('change', () => { state.settingsDirty = true; });
  }

  $('#confirm-cancel').addEventListener('click', () => closeConfirm(false));
  $('#confirm-ok').addEventListener('click', () => closeConfirm(true));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#job-modal').classList.contains('hidden')) closeJobModal();
    else if (!$('#confirm-modal').classList.contains('hidden')) closeConfirm(false);
    else $('#sidebar').classList.remove('open');
  });
}

async function init() {
  bindEvents();
  await loadState({ forceForms: true });
  connectEvents();
  navigate('dashboard', false);
  if (state.data?.profile) loadJobs(true);
  else renderJobs();
}

document.addEventListener('DOMContentLoaded', init);
