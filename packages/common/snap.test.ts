import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTimeResolution, snapSpan } from './snap.ts';

/** Snaps an ISO span and returns the result as ISO strings. */
function snap(start: string, stop: string, minutes: number, timeZone = 'UTC'): [string, string] {
  const span = snapSpan(new Date(start), new Date(stop), minutes, timeZone);
  return [span.start.toISOString(), span.stop.toISOString()];
}

const minutesBetween = ([start, stop]: [string, string]) => (Date.parse(stop) - Date.parse(start)) / 60_000;

test('a duration that is already a multiple of the resolution keeps its length', () => {
  assert.deepEqual(snap('2026-10-14T09:00:00Z', '2026-10-14T09:45:00Z', 15), ['2026-10-14T09:00:00.000Z', '2026-10-14T09:45:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:00:00Z', '2026-10-14T09:00:00Z', 15), ['2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z']);
  // Off the grid, the start moves but the duration stays 30 minutes.
  assert.deepEqual(snap('2026-10-14T09:02:00Z', '2026-10-14T09:32:00Z', 15), ['2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z']);
});

test('the duration rounds up, padding less than one step', () => {
  assert.equal(minutesBetween(snap('2026-10-14T09:00:00Z', '2026-10-14T09:00:01Z', 15)), 15);
  assert.equal(minutesBetween(snap('2026-10-14T09:00:00Z', '2026-10-14T09:15:01Z', 15)), 30);
  assert.equal(minutesBetween(snap('2026-10-14T09:00:00Z', '2026-10-14T09:29:59Z', 15)), 30);
  assert.equal(minutesBetween(snap('2026-10-14T09:00:00Z', '2026-10-14T09:04:59.999Z', 5)), 5);
});

test('the start snaps to the nearest grid point, down or up, and a tie goes up', () => {
  assert.deepEqual(snap('2026-10-14T09:07:29Z', '2026-10-14T09:20:00Z', 15), ['2026-10-14T09:00:00.000Z', '2026-10-14T09:15:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:07:31Z', '2026-10-14T09:20:00Z', 15), ['2026-10-14T09:15:00.000Z', '2026-10-14T09:30:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:07:30Z', '2026-10-14T09:20:00Z', 15), ['2026-10-14T09:15:00.000Z', '2026-10-14T09:30:00.000Z']);
});

test('a resolution of one minute snaps to whole minutes and one of 60 to whole hours', () => {
  assert.deepEqual(snap('2026-10-14T09:00:29Z', '2026-10-14T09:10:00Z', 1), ['2026-10-14T09:00:00.000Z', '2026-10-14T09:10:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:00:30Z', '2026-10-14T09:10:10Z', 1), ['2026-10-14T09:01:00.000Z', '2026-10-14T09:11:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:20:00Z', '2026-10-14T10:25:00Z', 60), ['2026-10-14T09:00:00.000Z', '2026-10-14T11:00:00.000Z']);
  assert.deepEqual(snap('2026-10-14T09:31:00Z', '2026-10-14T09:40:00Z', 60), ['2026-10-14T10:00:00.000Z', '2026-10-14T11:00:00.000Z']);
});

test('the grid follows the account clock in zones 30 or 45 minutes off UTC', () => {
  // Asia/Kolkata is UTC+5:30, so its whole hours fall at half past in UTC.
  assert.deepEqual(snap('2026-10-14T04:40:00Z', '2026-10-14T05:20:00Z', 60, 'Asia/Kolkata'), ['2026-10-14T04:30:00.000Z', '2026-10-14T05:30:00.000Z']);
  // Asia/Kathmandu is UTC+5:45: local 10:00 is 04:15 UTC and local 10:30 is 04:45 UTC.
  assert.deepEqual(snap('2026-10-14T04:20:00Z', '2026-10-14T05:00:00Z', 60, 'Asia/Kathmandu'), ['2026-10-14T04:15:00.000Z', '2026-10-14T05:15:00.000Z']);
  assert.deepEqual(snap('2026-10-14T04:40:00Z', '2026-10-14T05:00:00Z', 30, 'Asia/Kathmandu'), ['2026-10-14T04:45:00.000Z', '2026-10-14T05:15:00.000Z']);
});

test('a span across midnight snaps like any other', () => {
  assert.deepEqual(snap('2026-10-14T23:52:00Z', '2026-10-15T00:20:00Z', 15), ['2026-10-14T23:45:00.000Z', '2026-10-15T00:15:00.000Z']);
  assert.deepEqual(snap('2026-10-14T23:53:00Z', '2026-10-15T00:20:00Z', 15), ['2026-10-15T00:00:00.000Z', '2026-10-15T00:30:00.000Z']);
});

test('a span across a DST change keeps its rounded duration as elapsed time', () => {
  // Europe/Madrid falls back from 03:00 CEST to 02:00 CET at 01:00 UTC on 2026-10-25.
  const autumn = snap('2026-10-25T00:20:00Z', '2026-10-25T01:50:00Z', 60, 'Europe/Madrid');
  assert.deepEqual(autumn, ['2026-10-25T00:00:00.000Z', '2026-10-25T02:00:00.000Z']);
  assert.equal(minutesBetween(autumn), 120);
  // Europe/Madrid springs forward from 02:00 CET to 03:00 CEST at 01:00 UTC on 2026-03-29.
  const spring = snap('2026-03-29T00:50:00Z', '2026-03-29T01:40:00Z', 30, 'Europe/Madrid');
  assert.deepEqual(spring, ['2026-03-29T01:00:00.000Z', '2026-03-29T02:00:00.000Z']);
  assert.equal(minutesBetween(spring), 60);
});

test('the start stays on the clock grid across a DST change of half an hour', () => {
  const lordHowe = (start: string, stop: string, minutes: number) => snap(start, stop, minutes, 'Australia/Lord_Howe');
  // Lord Howe Island springs forward from 02:00 (UTC+10:30) to 02:30 (UTC+11) at 15:30 UTC on
  // 2026-10-03. Local 01:00 is 14:30 UTC, 02:00 never happens and local 03:00 is 16:00 UTC.
  assert.deepEqual(lordHowe('2026-10-03T15:20:00Z', '2026-10-03T15:25:00Z', 60), ['2026-10-03T16:00:00.000Z', '2026-10-03T17:00:00.000Z']);
  assert.deepEqual(lordHowe('2026-10-03T15:10:00Z', '2026-10-03T15:25:00Z', 60), ['2026-10-03T14:30:00.000Z', '2026-10-03T15:30:00.000Z']);
  // Local 02:30 exists on that day, and it is on the grid at a resolution of 30.
  assert.deepEqual(lordHowe('2026-10-03T15:20:00Z', '2026-10-03T15:25:00Z', 30), ['2026-10-03T15:30:00.000Z', '2026-10-03T16:00:00.000Z']);
  // It falls back from 02:00 (UTC+11) to 01:30 (UTC+10:30) at 15:00 UTC on 2026-04-04. Local 01:00
  // is 14:00 UTC and local 02:00 is 15:30 UTC; a tie between them goes to the later one.
  assert.deepEqual(lordHowe('2026-04-04T14:40:00Z', '2026-04-04T14:45:00Z', 60), ['2026-04-04T14:00:00.000Z', '2026-04-04T15:00:00.000Z']);
  assert.deepEqual(lordHowe('2026-04-04T15:10:00Z', '2026-04-04T15:15:00Z', 60), ['2026-04-04T15:30:00.000Z', '2026-04-04T16:30:00.000Z']);
  assert.deepEqual(lordHowe('2026-04-04T14:45:00Z', '2026-04-04T14:50:00Z', 60), ['2026-04-04T15:30:00.000Z', '2026-04-04T16:30:00.000Z']);
  // Local 01:30 happens twice, at 14:30 and 15:00 UTC, and both are on the grid at 30.
  assert.deepEqual(lordHowe('2026-04-04T14:50:00Z', '2026-04-04T14:55:00Z', 30), ['2026-04-04T15:00:00.000Z', '2026-04-04T15:30:00.000Z']);
  assert.deepEqual(lordHowe('2026-04-04T14:35:00Z', '2026-04-04T14:40:00Z', 30), ['2026-04-04T14:30:00.000Z', '2026-04-04T15:00:00.000Z']);
});

test('only divisors of 60 are resolutions, and a stop before the start is refused', () => {
  for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) assert.equal(isTimeResolution(minutes), true, String(minutes));
  for (const minutes of [0, -5, 7, 45, 90, 120, 2.5, Number.NaN]) assert.equal(isTimeResolution(minutes), false, String(minutes));
  assert.throws(() => snapSpan(new Date('2026-10-14T09:00:00Z'), new Date('2026-10-14T10:00:00Z'), 7, 'UTC'), RangeError);
  assert.throws(() => snapSpan(new Date('2026-10-14T10:00:00Z'), new Date('2026-10-14T09:00:00Z'), 5, 'UTC'), RangeError);
});
