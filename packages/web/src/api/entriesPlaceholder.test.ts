import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coversPreviousRange } from './entriesPlaceholder.ts';

const key = (start: string, end: string) => ['entries', start, end] as const;

test('a wider range keeps the previous rows (Show more days)', () => {
  assert.equal(coversPreviousRange(key('2026-10-08', '2026-10-15'), '2026-10-01', '2026-10-15'), true);
  assert.equal(coversPreviousRange(key('2026-10-08', '2026-10-15'), '2026-10-01', '2026-10-16'), true);
});

test('the same range keeps the previous rows', () => {
  assert.equal(coversPreviousRange(key('2026-10-08', '2026-10-15'), '2026-10-08', '2026-10-15'), true);
});

test('a range that does not cover the previous one starts empty', () => {
  const previous = key('2026-10-08', '2026-10-15');
  // Narrower on either side.
  assert.equal(coversPreviousRange(previous, '2026-10-09', '2026-10-15'), false);
  assert.equal(coversPreviousRange(previous, '2026-10-08', '2026-10-14'), false);
  // Shifted, overlapping.
  assert.equal(coversPreviousRange(previous, '2026-10-01', '2026-10-10'), false);
  // Disjoint, e.g. paging to the previous week.
  assert.equal(coversPreviousRange(previous, '2026-10-01', '2026-10-07'), false);
});

test('no previous query, or a key without string dates, keeps nothing', () => {
  assert.equal(coversPreviousRange(undefined, '2026-10-01', '2026-10-15'), false);
  assert.equal(coversPreviousRange(['entries'], '2026-10-01', '2026-10-15'), false);
  assert.equal(coversPreviousRange(['entries', 1, 2], '2026-10-01', '2026-10-15'), false);
});
