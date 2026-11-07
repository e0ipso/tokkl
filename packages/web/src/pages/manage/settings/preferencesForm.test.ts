import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Preferences } from '../../../api/types.ts';
import {
  changesFrom,
  dateFormatOptions,
  editableOf,
  isStored,
  numberErrors,
  refusedField,
  toDraft,
} from './preferencesForm.ts';

const prefs: Preferences = {
  date_format: 'YYYY-MM-DD',
  timeofday_format: 'H:mm',
  duration_format: 'improved',
  collapseTimeEntries: true,
  manualMode: false,
  keyboard_shortcuts_enabled: true,
  theme: 'dark',
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  pomodoro_long_break_interval_in_minutes: 15,
  pomodoro_long_break_every: 4,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
};

test('the draft shows numbers as the text in their inputs', () => {
  const draft = toDraft(editableOf(prefs));
  assert.equal(draft.pomodoro_long_break_every, '4');
  assert.equal(draft.theme, 'dark');
  assert.equal('manualMode' in draft, false);
});

test('a typed number is stored when its value matches, whatever its text', () => {
  const stored = editableOf(prefs);
  assert.equal(isStored('pomodoro_long_break_every', ' 4 ', stored), true);
  assert.equal(isStored('pomodoro_long_break_every', '4.5', stored), false);
  assert.equal(isStored('theme', 'dark', stored), true);
});

test('a save sends typed numbers as numbers', () => {
  assert.deepEqual(changesFrom({ long_timer_reminder_hours: ' 12 ', theme: 'light' }), {
    long_timer_reminder_hours: 12,
    theme: 'light',
  });
});

test('number fields refuse text that is not a whole number', () => {
  const draft = {
    ...toDraft(editableOf(prefs)),
    pomodoro_focus_interval_in_minutes: '2.5',
    long_timer_reminder_hours: '',
  };
  const errors = new Map(numberErrors(draft));
  assert.equal(errors.get('pomodoro_focus_interval_in_minutes'), 'Enter a whole number of minutes');
  assert.equal(errors.get('long_timer_reminder_hours'), 'Enter a whole number of hours');
  assert.equal(errors.get('pomodoro_long_break_every'), false);
});

test('a server refusal names the field it is about', () => {
  assert.equal(refusedField('Invalid pomodoro_long_break_every: expected 1 to 12'), 'pomodoro_long_break_every');
  assert.equal(refusedField('Server error'), undefined);
});

test('a saved date format the form does not offer stays first', () => {
  assert.equal(dateFormatOptions('YYYY-MM-DD').length, 6);
  assert.deepEqual(dateFormatOptions('D/M/YY').slice(0, 2), ['D/M/YY', 'YYYY-MM-DD']);
});
