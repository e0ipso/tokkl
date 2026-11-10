import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PomodoroLimits, Preferences } from '@tokkl/types';
import { LENGTH_FIELDS, lengthText, sessionConfig } from './sessionLengths.ts';

const preferences: Preferences = {
  date_format: 'YYYY-MM-DD',
  timeofday_format: 'H:mm',
  duration_format: 'improved',
  collapseTimeEntries: true,
  manualMode: false,
  keyboard_shortcuts_enabled: true,
  theme: 'system',
  pomodoro_focus_interval_in_minutes: 50,
  pomodoro_break_interval_in_minutes: 10,
  pomodoro_long_break_interval_in_minutes: 30,
  pomodoro_long_break_every: 3,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
};

/** Unlike the limits this repo's server ships with. */
const limits: PomodoroLimits = {
  work_minutes: { min: 10, max: 60, default: 45 },
  short_rest_minutes: { min: 2, max: 20, default: 8 },
  long_rest_minutes: { min: 5, max: 40, default: 20 },
  long_rest_every: { min: 2, max: 6, default: 3 },
};

test('a card shows the typed text, else the saved preference', () => {
  const [work] = LENGTH_FIELDS;
  assert.equal(lengthText({}, preferences, limits, work), '50');
  assert.equal(lengthText({ workMinutes: '4' }, preferences, limits, work), '4');
});

test("an account that never saved a length starts from the server's default", () => {
  const { pomodoro_focus_interval_in_minutes: _unsaved, ...older } = preferences;
  const [work] = LENGTH_FIELDS;
  assert.equal(lengthText({}, { ...older } as Preferences, limits, work), '45');
});

test('the session takes the cards as numbers', () => {
  assert.deepEqual(sessionConfig({ shortRestMinutes: ' 7 ', workMinutes: '60' }, preferences, limits), {
    config: { workMinutes: 60, shortRestMinutes: 7, longRestMinutes: 30, longRestEvery: 3 },
  });
});

test('the first card out of range stops the start', () => {
  assert.deepEqual(sessionConfig({ longRestMinutes: '0', longRestEvery: 'x' }, preferences, limits), {
    invalid: 'longRestMinutes',
  });
});

test("the server's limits decide what is in range", () => {
  assert.deepEqual(sessionConfig({ workMinutes: '61' }, preferences, limits), { invalid: 'workMinutes' });
  assert.deepEqual(sessionConfig({ longRestEvery: '1' }, preferences, limits), { invalid: 'longRestEvery' });
});
