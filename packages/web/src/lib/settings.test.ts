import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snappedInstant, snappedSeconds, snappedSplit, type SplitHalves } from './settings.ts';

const utc = (timeResolution: number) => ({ timeZone: 'UTC', timeResolution });
const at = (iso: string) => new Date(iso);

test('snappedSeconds rounds the duration up to the resolution', () => {
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T09:15:00Z'), utc(15)), 900);
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T09:15:01Z'), utc(15)), 1800);
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T09:01:01Z'), utc(1)), 120);
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T09:00:01Z'), utc(60)), 3600);
  // Moving the start to the grid does not change the duration.
  assert.equal(snappedSeconds(at('2026-10-16T09:07:00Z'), at('2026-10-16T09:22:00Z'), utc(15)), 900);
});

test('snappedSeconds cuts both ends to whole seconds first, as the server does', () => {
  // 900.5 s of real time, but 900 s once each end drops its milliseconds.
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00.400Z'), at('2026-10-16T09:15:00.900Z'), utc(15)), 900);
  // Both ends in the same second: nothing to store.
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00.100Z'), at('2026-10-16T09:00:00.900Z'), utc(15)), 0);
});

test('snappedSeconds is zero for a stop at or before the start', () => {
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T09:00:00Z'), utc(15)), 0);
  assert.equal(snappedSeconds(at('2026-10-16T09:00:00Z'), at('2026-10-16T08:00:00Z'), utc(15)), 0);
});

test('snappedSeconds counts elapsed time across a DST change', () => {
  // Madrid falls back at 01:00 UTC on 2026-10-25: 02:30 to 02:30 local again is one hour.
  const madrid = { timeZone: 'Europe/Madrid', timeResolution: 15 };
  assert.equal(snappedSeconds(at('2026-10-25T00:30:00Z'), at('2026-10-25T01:30:00Z'), madrid), 3600);
  // Lord Howe springs forward half an hour at 15:30 UTC on 2026-10-03.
  const lordHowe = { timeZone: 'Australia/Lord_Howe', timeResolution: 30 };
  assert.equal(snappedSeconds(at('2026-10-03T15:20:00Z'), at('2026-10-03T15:45:00Z'), lordHowe), 1800);
});

test('snappedInstant picks the nearest grid point and a tie goes up', () => {
  assert.equal(snappedInstant(at('2026-10-16T09:07:29.999Z'), utc(15)).toISOString(), '2026-10-16T09:00:00.000Z');
  assert.equal(snappedInstant(at('2026-10-16T09:07:30.000Z'), utc(15)).toISOString(), '2026-10-16T09:15:00.000Z');
  assert.equal(snappedInstant(at('2026-10-16T09:15:00.000Z'), utc(15)).toISOString(), '2026-10-16T09:15:00.000Z');
  assert.equal(snappedInstant(at('2026-10-16T09:00:29.500Z'), utc(1)).toISOString(), '2026-10-16T09:00:00.000Z');
});

test('snappedInstant follows the wall clock of the time zone', () => {
  // Kathmandu is UTC+5:45, so a whole local hour falls at :15 UTC.
  const kathmandu = { timeZone: 'Asia/Kathmandu', timeResolution: 60 };
  assert.equal(snappedInstant(at('2026-10-16T04:40:00Z'), kathmandu).toISOString(), '2026-10-16T04:15:00.000Z');
  assert.equal(snappedInstant(at('2026-10-16T04:50:00Z'), kathmandu).toISOString(), '2026-10-16T05:15:00.000Z');
  // On Lord Howe, local 02:00 never happens on 2026-10-03; 02:30 local (15:30 UTC) is the grid point.
  const lordHowe = { timeZone: 'Australia/Lord_Howe', timeResolution: 30 };
  assert.equal(snappedInstant(at('2026-10-03T15:20:00Z'), lordHowe).toISOString(), '2026-10-03T15:30:00.000Z');
});

test('halves split at snappedInstant add up to the snapped whole', () => {
  const settings = utc(15);
  const start = at('2026-10-16T09:00:00Z');
  const stop = at('2026-10-16T10:00:00Z');
  const split = snappedInstant(at('2026-10-16T09:22:10.700Z'), settings);
  assert.equal(split.toISOString(), '2026-10-16T09:15:00.000Z');
  const first = snappedSeconds(start, split, settings);
  const second = snappedSeconds(split, stop, settings);
  assert.deepEqual([first, second], [900, 2700]);
  assert.equal(first + second, snappedSeconds(start, stop, settings));
});

const isoHalves = (halves: SplitHalves | string) => typeof halves === 'string' ? halves : [
  [halves.first.start.toISOString(), halves.first.stop.toISOString()],
  [halves.second.start.toISOString(), halves.second.stop.toISOString()],
];

test('snappedSplit returns the halves the server stores, meeting at the split', () => {
  const halves = snappedSplit(at('2026-10-16T09:00:00Z'), at('2026-10-16T10:00:00Z'), at('2026-10-16T09:15:00Z'), utc(15));
  assert.deepEqual(isoHalves(halves), [
    ['2026-10-16T09:00:00.000Z', '2026-10-16T09:15:00.000Z'],
    ['2026-10-16T09:15:00.000Z', '2026-10-16T10:00:00.000Z'],
  ]);
});

test('snappedSplit cuts an entry saved under another resolution from its snapped whole', () => {
  // At 15 minutes, 09:08 to 10:08 stores as 09:15 to 10:15. Snapping 09:08 to 09:30 on its own would
  // store 09:15 to 09:45, over the second half.
  const halves = snappedSplit(at('2026-10-16T09:08:00Z'), at('2026-10-16T10:08:00Z'), at('2026-10-16T09:30:00Z'), utc(15));
  assert.deepEqual(isoHalves(halves), [
    ['2026-10-16T09:15:00.000Z', '2026-10-16T09:30:00.000Z'],
    ['2026-10-16T09:30:00.000Z', '2026-10-16T10:15:00.000Z'],
  ]);
});

test('snappedSplit refuses a split on or outside the snapped start and stop', () => {
  const start = at('2026-10-16T09:08:00Z');
  const stop = at('2026-10-16T10:08:00Z');
  assert.equal(snappedSplit(start, stop, at('2026-10-16T09:15:00Z'), utc(15)), 'outside');
  assert.equal(snappedSplit(start, stop, at('2026-10-16T10:15:00Z'), utc(15)), 'outside');
  assert.equal(snappedSplit(start, stop, at('2026-10-16T09:00:00Z'), utc(15)), 'outside');
});

test('snappedSplit refuses a split whose halves would overlap across a half-hour clock change', () => {
  // Lord Howe springs forward from 02:00 (UTC+10:30) to 02:30 (UTC+11) at 15:30 UTC on 2026-10-03.
  // At a resolution of 60, 14:30 to 16:30 UTC is local 01:00 to 03:30, and local 03:00 (16:00 UTC)
  // is the only grid point inside it. Saved on their own, the halves would be 14:30 to 16:30 and
  // 16:00 to 17:00 UTC: a 30-minute overlap and three hours in total.
  const lordHowe = { timeZone: 'Australia/Lord_Howe', timeResolution: 60 };
  const start = at('2026-10-03T14:30:00Z');
  const stop = at('2026-10-03T16:30:00Z');
  const split = snappedInstant(at('2026-10-03T16:00:00Z'), lordHowe);
  assert.equal(split.toISOString(), '2026-10-03T16:00:00.000Z');
  assert.equal(snappedSplit(start, stop, split, lordHowe), 'clock-change');
  // At a resolution of 30, the half hour on either side of the change is a whole step, so it splits.
  assert.deepEqual(isoHalves(snappedSplit(start, stop, split, { ...lordHowe, timeResolution: 30 })), [
    ['2026-10-03T14:30:00.000Z', '2026-10-03T16:00:00.000Z'],
    ['2026-10-03T16:00:00.000Z', '2026-10-03T16:30:00.000Z'],
  ]);
});
