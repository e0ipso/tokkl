import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noTimeDuration } from './noTimeDuration.ts';

// A no-time entry stores its duration snapped to the resolution, so the form checks that value.

test('a readable duration is snapped to the resolution', () => {
  assert.deepEqual(noTimeDuration('1:30', 1), { seconds: 5400 });
  assert.deepEqual(noTimeDuration('53m', 15), { seconds: 3600 });
  assert.deepEqual(noTimeDuration('7m', 15), { seconds: 0, error: 'The duration rounds to zero at the 15-minute time resolution' });
});

test('unreadable text is an error', () => {
  assert.deepEqual(noTimeDuration('', 1), { seconds: null, error: 'Enter a duration like 1:30 or 90m' });
  assert.deepEqual(noTimeDuration('soon', 5), { seconds: null, error: 'Enter a duration like 1:30 or 90m' });
});

test('more than 24 hours after snapping is an error, exactly 24 hours is not', () => {
  assert.deepEqual(noTimeDuration('24h', 15), { seconds: 24 * 3600 });
  assert.deepEqual(noTimeDuration('24:07', 15), { seconds: 24 * 3600 });
  assert.deepEqual(noTimeDuration('24:08', 15), { seconds: 24 * 3600 + 15 * 60, error: 'No-time entries can be at most 24 hours' });
});
