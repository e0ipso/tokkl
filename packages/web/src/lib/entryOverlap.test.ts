import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlappingIds, type OverlapEntry } from './entryOverlap.ts';

function entry(id: number, start: string, stop: string, all_day = false): OverlapEntry {
  return { id, start, stop, all_day };
}

test('timed entries that overlap are flagged', () => {
  const ids = overlappingIds([
    entry(1, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
    entry(2, '2026-10-01T09:30:00Z', '2026-10-01T10:30:00Z'),
    entry(3, '2026-10-01T10:30:00Z', '2026-10-01T11:00:00Z'),
  ]);
  assert.deepEqual([...ids].sort(), [1, 2]);
});

test('a no-time entry overlapping a timed one in stored instants flags neither', () => {
  const ids = overlappingIds([
    entry(1, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
    entry(2, '2026-10-01T00:00:00Z', '2026-10-01T09:30:00Z', true),
  ]);
  assert.equal(ids.size, 0);
});

test('a no-time entry does not hide an overlap between timed entries', () => {
  const ids = overlappingIds([
    entry(1, '2026-10-01T08:00:00Z', '2026-10-01T18:00:00Z', true),
    entry(2, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
    entry(3, '2026-10-01T09:30:00Z', '2026-10-01T10:30:00Z'),
  ]);
  assert.deepEqual([...ids].sort(), [2, 3]);
});
