import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayTotals, layoutBlocks, minuteToPx, pxToMinute, rangeTotal, snapMinute } from './calendarLayout.ts';
import { timeEntry } from '../testFixtures.ts';

const entry = (id: number, start: string, stop: string | null) =>
  timeEntry({
    id,
    start,
    stop,
    duration: stop ? (Date.parse(stop) - Date.parse(start)) / 1000 : -1,
    description: '',
    at: start,
  });

test('snapMinute rounds to whole steps and stays on the day', () => {
  assert.equal(snapMinute(22, 15), 15);
  assert.equal(snapMinute(23, 15), 30);
  assert.equal(snapMinute(-10, 15), 0);
  assert.equal(snapMinute(24 * 60 + 40, 15), 24 * 60);
});

test('an hour is 48 px both ways', () => {
  assert.equal(minuteToPx(90), 72);
  assert.equal(pxToMinute(72), 90);
});

test('dayTotals sums per start day, a running entry up to now, and rangeTotal adds the days asked for', () => {
  const now = new Date('2026-10-21T10:30:00Z');
  const totals = dayTotals(
    [
      entry(1, '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'),
      entry(2, '2026-10-20T11:00:00Z', '2026-10-20T11:30:00Z'),
      entry(3, '2026-10-21T10:00:00Z', null),
    ],
    'UTC',
    now,
  );
  assert.deepEqual(
    [...totals],
    [
      ['2026-10-20', 5400],
      ['2026-10-21', 1800],
    ],
  );
  assert.equal(rangeTotal(totals, '2026-10-19', '2026-10-25'), 7200);
  assert.equal(rangeTotal(totals, '2026-10-21', '2026-10-21'), 1800);
});

test('layoutBlocks splits an overnight entry over both days and puts overlaps in lanes', () => {
  const overnight = entry(1, '2026-10-20T23:00:00Z', '2026-10-21T01:00:00Z');
  const overlap = entry(2, '2026-10-21T00:30:00Z', '2026-10-21T02:00:00Z');
  const blocks = layoutBlocks([overnight, overlap], ['2026-10-20', '2026-10-21'], 'UTC', new Date());
  assert.deepEqual(
    blocks.get('2026-10-20')!.map(b => [b.entry.id, b.top, b.bottom]),
    [[1, 23 * 60, 24 * 60]],
  );
  const second = blocks.get('2026-10-21')!;
  assert.deepEqual(
    second.map(b => [b.entry.id, b.top, b.bottom, b.lanes]),
    [
      [1, 0, 60, 2],
      [2, 30, 120, 2],
    ],
  );
});
