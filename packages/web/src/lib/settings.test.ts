import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Preferences } from '@tokkl/types';
import { settingsFrom } from './settings.ts';

test("the time resolution comes from the user's preferences", () => {
  const prefs = { time_resolution_minutes: 15 } as Preferences;
  assert.equal(settingsFrom(undefined, prefs).timeResolution, 15);
});

test('the time resolution is exact until the preferences load', () => {
  assert.equal(settingsFrom(undefined, undefined).timeResolution, 1);
});
