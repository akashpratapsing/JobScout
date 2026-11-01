import test from 'node:test';
import assert from 'node:assert/strict';
import { localClock, isScheduleDue } from '../server/scheduler.js';

test('localClock returns the date and minutes in the configured timezone', () => {
  const now = new Date('2026-10-30T03:35:00Z');
  const ist = localClock(now, 'Asia/Kolkata');
  assert.equal(ist.date, '2026-10-30');
  assert.equal(ist.hour, 9);
  assert.equal(ist.minute, 5);
  assert.equal(ist.minutes, 9 * 60 + 5);

  const utc = localClock(now, 'UTC');
  assert.equal(utc.date, '2026-10-30');
  assert.equal(utc.minutes, 3 * 60 + 35);
});

test('localClock falls back safely for an unknown timezone', () => {
  const now = new Date('2026-10-30T03:35:00Z');
  const clock = localClock(now, 'Not/AZone');
  assert.equal(clock.date, '2026-10-30');
  assert.equal(clock.minutes, 3 * 60 + 35);
});

test('isScheduleDue enforces disabled, invalid, already-ran and grace windows', () => {
  const now = new Date('2026-10-30T03:35:00Z'); // 09:05 IST
  const base = { enabled: true, time: '09:00', timezone: 'Asia/Kolkata', lastRunDate: null, now };

  assert.equal(isScheduleDue({ ...base, enabled: false }).due, false);
  assert.equal(isScheduleDue({ ...base, enabled: false }).reason, 'disabled');
  assert.equal(isScheduleDue({ ...base, time: '9:00' }).reason, 'invalid-time');
  assert.equal(isScheduleDue({ ...base, lastRunDate: '2026-10-30' }).reason, 'already-ran');
  assert.equal(isScheduleDue({ ...base, time: '10:00' }).reason, 'not-yet');
  assert.equal(isScheduleDue({ ...base, time: '08:00' }).reason, 'missed-window');
  assert.equal(isScheduleDue(base).due, true);
  assert.equal(isScheduleDue(base).reason, 'due');

  // 09:20 is inside the 20-minute window; 09:21 is not.
  assert.equal(isScheduleDue({ ...base, now: new Date('2026-10-30T03:50:00Z') }).due, true);
  assert.equal(isScheduleDue({ ...base, now: new Date('2026-10-30T03:51:00Z') }).due, false);
});

test('the grace window is configurable', () => {
  const now = new Date('2026-10-30T04:00:00Z'); // 09:30 IST
  const base = { enabled: true, time: '09:00', timezone: 'Asia/Kolkata', lastRunDate: null, now };
  assert.equal(isScheduleDue(base, ).due, false);
  assert.equal(isScheduleDue({ ...base, graceMinutes: 45 }).due, true);
});
