import { getActiveRunId, runSearch } from './jobs/discovery.js';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_GRACE_MINUTES = 20;

export function localClock(now = new Date(), timezone = 'Asia/Kolkata') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    const date = `${value('year')}-${value('month')}-${value('day')}`;
    const hour = Number(value('hour'));
    const minute = Number(value('minute'));
    return { date, hour, minute, minutes: hour * 60 + minute };
  } catch {
    const date = now.toISOString().slice(0, 10);
    return { date, hour: now.getUTCHours(), minute: now.getUTCMinutes(), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

export function isScheduleDue({ enabled, time, timezone, lastRunDate, now = new Date(), graceMinutes = DEFAULT_GRACE_MINUTES }) {
  if (!enabled) return { due: false, reason: 'disabled', clock: localClock(now, timezone) };
  const match = String(time || '').match(TIME_RE);
  const clock = localClock(now, timezone);
  if (!match) return { due: false, reason: 'invalid-time', clock };
  if (lastRunDate === clock.date) return { due: false, reason: 'already-ran', clock };
  const scheduled = Number(match[1]) * 60 + Number(match[2]);
  const delta = clock.minutes - scheduled;
  if (delta < 0) return { due: false, reason: 'not-yet', clock };
  if (delta > graceMinutes) return { due: false, reason: 'missed-window', clock };
  return { due: true, reason: 'due', clock };
}

/**
 * Runs one search per day at the configured local time. It deliberately does
 * not catch up on missed days: if JobScout was not running within the grace
 * window, the search is skipped rather than fired hours later.
 */
export function startScheduler({ store, logger, secret, onEvent = () => {}, intervalMs = 30000, graceMinutes = DEFAULT_GRACE_MINUTES }) {
  let timer = null;
  let ticking = false;
  let stopped = false;

  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const state = store.get();
      const preferences = state.preferences || {};
      const timezone = preferences.dailyTimezone || 'Asia/Kolkata';
      const due = isScheduleDue({
        enabled: Boolean(preferences.dailyEnabled),
        time: preferences.dailyTime,
        timezone,
        lastRunDate: state.meta.lastScheduledDate,
        graceMinutes
      });
      if (!due.due) return;
      if (getActiveRunId()) {
        logger.warn('Scheduled search skipped because another search is running.');
        return;
      }
      if (!state.profile) {
        logger.warn('Scheduled search skipped because no resume/profile is configured.');
        return;
      }
      const sources = (preferences.enabledSources || []).filter(Boolean);
      if (!sources.length) {
        logger.warn('Scheduled search skipped because no sources are enabled.');
        return;
      }

      // Record the date before starting so a failed run does not retry in a loop.
      await store.update((data) => {
        data.meta.lastScheduledDate = due.clock.date;
        data.settings.schedule = {
          ...(data.settings.schedule || {}),
          enabled: true,
          time: preferences.dailyTime,
          timezone,
          lastRunDate: due.clock.date
        };
      });
      logger.info(`Starting scheduled search for ${due.clock.date} ${preferences.dailyTime} ${timezone}.`);
      onEvent({ type: 'scheduled-start', at: new Date().toISOString() });
      runSearch({
        store,
        logger,
        secret,
        reason: 'scheduled',
        onRunCreated: (run) => onEvent({ type: 'run', run }),
        onProgress: (run) => onEvent({ type: 'run', run })
      }).catch((error) => {
        logger.error('Scheduled search failed', { error: error.message, code: error.code });
        onEvent({ type: 'run-error', error: String(error.message || error) });
      });
    } catch (error) {
      logger.error('Scheduler tick failed', { error: error.message });
    } finally {
      ticking = false;
    }
  }

  const initial = setTimeout(tick, 5000);
  if (initial.unref) initial.unref();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
    },
    tick
  };
}
