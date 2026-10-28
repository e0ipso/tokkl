import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noTimeFields } from './noTimeEdit.ts';

const initial = { day: '2026-03-10', seconds: 5400 };

test('a timed entry switched to no-time sends the flag, the day and the duration', () => {
  assert.deepEqual(
    noTimeFields({ all_day: false }, { day: '2026-03-10', seconds: 5400 }, initial),
    { all_day: true, start_date: '2026-03-10', duration: 5400 },
  );
});

test('a no-time entry with the same day and duration sends no time fields', () => {
  assert.deepEqual(noTimeFields({ all_day: true }, { ...initial }, initial), {});
});

test('a changed day or duration sends the flag with both values', () => {
  assert.deepEqual(
    noTimeFields({ all_day: true }, { day: '2026-03-11', seconds: 5400 }, initial),
    { all_day: true, start_date: '2026-03-11', duration: 5400 },
  );
  assert.deepEqual(
    noTimeFields({ all_day: true }, { day: '2026-03-10', seconds: 3600 }, initial),
    { all_day: true, start_date: '2026-03-10', duration: 3600 },
  );
});
