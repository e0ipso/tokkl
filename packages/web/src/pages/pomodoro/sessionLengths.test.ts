import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POMODORO_SESSION_CONFIG } from '@tokkl/common/pomodoroSession';
import type { Preferences } from '../../api/types.ts';
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

test('a card shows the typed text, else the saved preference', () => {
  const [work] = LENGTH_FIELDS;
  assert.equal(lengthText({}, preferences, work), '50');
  assert.equal(lengthText({ workMinutes: '4' }, preferences, work), '4');
});

test('an account that never saved a length starts from the default', () => {
  const { pomodoro_focus_interval_in_minutes: _unsaved, ...older } = preferences;
  const [work] = LENGTH_FIELDS;
  assert.equal(lengthText({}, { ...older } as Preferences, work), String(DEFAULT_POMODORO_SESSION_CONFIG.workMinutes));
});

test('the session takes the cards as numbers', () => {
  assert.deepEqual(sessionConfig({ shortRestMinutes: ' 7 ' }, preferences), {
    config: { workMinutes: 50, shortRestMinutes: 7, longRestMinutes: 30, longRestEvery: 3 },
  });
});

test('the first card out of range stops the start', () => {
  assert.deepEqual(sessionConfig({ longRestMinutes: '0', longRestEvery: 'x' }, preferences), {
    invalid: 'longRestMinutes',
  });
});
