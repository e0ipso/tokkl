import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addClockMinutes, addDays, canonicalTimeZone, clockMinutes, clockSpanOnDay, dateKey, startOfDay, startOfWeek, zonedToUtc,
} from './time.ts';

test('canonicalTimeZone folds case and returns the name Intl resolves', () => {
  assert.equal(canonicalTimeZone('Europe/Madrid'), 'Europe/Madrid');
  assert.equal(canonicalTimeZone('europe/madrid'), 'Europe/Madrid');
  assert.equal(canonicalTimeZone('AMERICA/NEW_YORK'), 'America/New_York');
});

test('canonicalTimeZone maps the UTC aliases to UTC', () => {
  for (const name of ['UTC', 'utc', 'Etc/UTC', 'etc/utc', 'GMT', 'Etc/GMT']) assert.equal(canonicalTimeZone(name), 'UTC', name);
});

test('canonicalTimeZone refuses offset IDs, also the ones Intl accepts', () => {
  for (const name of ['+02:00', '-0500', '-05:00', '\u221205:00', '+23:59', '+00:00']) assert.equal(canonicalTimeZone(name), null, name);
});

test('canonicalTimeZone refuses names Intl does not know', () => {
  for (const name of ['', 'Bogus/Zone', 'Europe/Nowhere', 'Z', ' Europe/Madrid']) assert.equal(canonicalTimeZone(name), null, name);
});

test('startOfDay handles DST transitions', () => {
  // Europe/Madrid switches to CEST on 2026-03-29.
  assert.equal(startOfDay('2026-03-29', 'Europe/Madrid').toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(startOfDay('2026-03-30', 'Europe/Madrid').toISOString(), '2026-03-29T22:00:00.000Z');
  assert.equal(startOfDay('2026-01-01', 'America/New_York').toISOString(), '2026-01-01T05:00:00.000Z');
});

test('zonedToUtc and dateKey round-trip', () => {
  const instant = zonedToUtc(2026, 10, 14, 23, 30, 0, 'Asia/Tokyo');
  assert.equal(instant.toISOString(), '2026-10-14T14:30:00.000Z');
  assert.equal(dateKey(instant, 'Asia/Tokyo'), '2026-10-14');
  assert.equal(dateKey(instant, 'UTC'), '2026-10-14');
  assert.equal(dateKey(instant, 'America/Los_Angeles'), '2026-10-14');
});

test('calendar helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  // 2026-10-14 is a Wednesday.
  assert.equal(startOfWeek('2026-10-14', 1), '2026-10-12');
  assert.equal(startOfWeek('2026-10-14', 0), '2026-10-11');
  assert.equal(startOfWeek('2026-10-12', 1), '2026-10-12');
});

test('startOfDay where midnight does not exist starts the day after the gap', () => {
  // Santiago springs forward at 24:00 on 2026-09-05, so 2026-09-06 starts at 01:00 local (04:00Z).
  const start = startOfDay('2026-09-06', 'America/Santiago');
  assert.equal(dateKey(start, 'America/Santiago'), '2026-09-06');
  assert.equal(dateKey(new Date(start.getTime() - 60_000), 'America/Santiago'), '2026-09-05');
  const havana = startOfDay('2026-03-08', 'America/Havana');
  assert.equal(dateKey(havana, 'America/Havana'), '2026-03-08');
  assert.equal(dateKey(new Date(havana.getTime() - 60_000), 'America/Havana'), '2026-03-07');
});

const MADRID = 'Europe/Madrid';
const at = (iso: string) => new Date(iso);
const hours = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

test('clockMinutes reads the local wall clock, with seconds as a fraction', () => {
  // 2026-03-29 is the Madrid spring change: 08:00Z is 10:00 CEST.
  assert.equal(clockMinutes(at('2026-03-29T08:00:00Z'), MADRID), 600);
  // 2026-10-25 is the autumn change: 09:00Z is 10:00 CET.
  assert.equal(clockMinutes(at('2026-10-25T09:00:00Z'), MADRID), 600);
  assert.equal(clockMinutes(at('2026-10-14T08:00:30Z'), MADRID), 600.5);
});

test('clockSpanOnDay places entries by clock time on Madrid DST days', () => {
  // Spring: a 10:00-11:00 entry sits at 600-660, not one hour higher.
  assert.deepEqual(clockSpanOnDay(at('2026-03-29T08:00:00Z'), at('2026-03-29T09:00:00Z'), '2026-03-29', MADRID),
    { top: 600, bottom: 660 });
  // 01:30 CET to 03:30 CEST is one hour of elapsed time across the gap but spans 90-210 on the clock.
  assert.deepEqual(clockSpanOnDay(at('2026-03-29T00:30:00Z'), at('2026-03-29T01:30:00Z'), '2026-03-29', MADRID),
    { top: 90, bottom: 210 });
  // Autumn: 10:00-11:00 CET.
  assert.deepEqual(clockSpanOnDay(at('2026-10-25T09:00:00Z'), at('2026-10-25T10:00:00Z'), '2026-10-25', MADRID),
    { top: 600, bottom: 660 });
  // Inside the repeated hour, 02:30 CEST to 02:15 CET ends above where it starts.
  assert.deepEqual(clockSpanOnDay(at('2026-10-25T00:30:00Z'), at('2026-10-25T01:15:00Z'), '2026-10-25', MADRID),
    { top: 150, bottom: 135 });
});

test('clockSpanOnDay clips multi-day entries and skips days they miss', () => {
  // 2026-03-28 22:00 CET to 2026-03-30 02:00 CEST.
  const start = at('2026-03-28T21:00:00Z');
  const stop = at('2026-03-30T00:00:00Z');
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-03-28', MADRID), { top: 1320, bottom: 1440 });
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-03-29', MADRID), { top: 0, bottom: 1440 });
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-03-30', MADRID), { top: 0, bottom: 120 });
  assert.equal(clockSpanOnDay(start, stop, '2026-03-27', MADRID), null);
  assert.equal(clockSpanOnDay(start, stop, '2026-03-31', MADRID), null);
  // A stop exactly at the day's first instant, or a start exactly at the next midnight, misses the day.
  assert.equal(clockSpanOnDay(at('2026-03-28T20:00:00Z'), at('2026-03-28T23:00:00Z'), '2026-03-29', MADRID), null);
  assert.equal(clockSpanOnDay(at('2026-03-29T22:00:00Z'), at('2026-03-29T23:00:00Z'), '2026-03-29', MADRID), null);
});

test('clockSpanOnDay on a day whose midnight does not exist', () => {
  // Santiago: 2026-09-05 23:00 (-04, 03:00Z) to 2026-09-06 02:00 (-03, 05:00Z); 2026-09-06 starts at 01:00.
  const start = at('2026-09-06T03:00:00Z');
  const stop = at('2026-09-06T05:00:00Z');
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-09-05', 'America/Santiago'), { top: 1380, bottom: 1440 });
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-09-06', 'America/Santiago'), { top: 0, bottom: 120 });
  // An entry starting at the first instant of the day sits at 01:00 on the clock.
  assert.deepEqual(clockSpanOnDay(at('2026-09-06T04:00:00Z'), stop, '2026-09-06', 'America/Santiago'),
    { top: 60, bottom: 120 });
});

test('addClockMinutes shifts by local clock time across Madrid DST changes', () => {
  // Spring: 01:00 CET plus 120 clock minutes is 03:00 CEST, one hour of elapsed time.
  const one = at('2026-03-29T00:00:00Z');
  assert.equal(addClockMinutes(one, 120, MADRID).toISOString(), '2026-03-29T01:00:00.000Z');
  // A result inside the spring gap (02:30) lands after it, at 03:30 CEST.
  assert.equal(addClockMinutes(at('2026-03-29T00:30:00Z'), 60, MADRID).toISOString(), '2026-03-29T01:30:00.000Z');
  // Autumn: 01:30 CEST plus 60 is 02:30, which happens twice; it resolves to the later one (CET).
  assert.equal(addClockMinutes(at('2026-10-24T23:30:00Z'), 60, MADRID).toISOString(), '2026-10-25T01:30:00.000Z');
  // 00:00 CEST plus 240 is 04:00 CET, five hours of elapsed time.
  assert.equal(addClockMinutes(at('2026-10-24T22:00:00Z'), 240, MADRID).toISOString(), '2026-10-25T03:00:00.000Z');
});

test('addClockMinutes handles negative shifts, midnight crossings and milliseconds', () => {
  // 03:00 CEST minus 120 is 01:00 CET.
  assert.equal(addClockMinutes(at('2026-03-29T01:00:00Z'), -120, MADRID).toISOString(), '2026-03-29T00:00:00.000Z');
  // 23:00 CET on the 28th plus 240 is 03:00 CEST on the 29th.
  assert.equal(addClockMinutes(at('2026-03-28T22:00:00Z'), 240, MADRID).toISOString(), '2026-03-29T01:00:00.000Z');
  // 00:30 CET on the 29th minus 60 is 23:30 CET on the 28th.
  assert.equal(addClockMinutes(at('2026-03-28T23:30:00Z'), -60, MADRID).toISOString(), '2026-03-28T22:30:00.000Z');
  // 04:00 CET on 2026-10-26 minus 240 crosses midnight back to 00:00 CET.
  assert.equal(addClockMinutes(at('2026-10-26T03:00:00Z'), -240, MADRID).toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(addClockMinutes(at('2026-10-14T08:00:05.250Z'), 30, MADRID).toISOString(), '2026-10-14T08:30:05.250Z');
  assert.equal(addClockMinutes(at('2026-10-14T08:00:00Z'), 0, MADRID).toISOString(), '2026-10-14T08:00:00.000Z');
});

test('the next local day at a clock time spans DST nights correctly', () => {
  // A 10:00 to 09:00-next-day range is 22 hours on the spring night and 24 on the autumn night.
  assert.equal(hours(zonedToUtc(2026, 3, 28, 10, 0, 0, MADRID), zonedToUtc(2026, 3, 29, 9, 0, 0, MADRID)), 22);
  assert.equal(hours(zonedToUtc(2026, 10, 24, 10, 0, 0, MADRID), zonedToUtc(2026, 10, 25, 9, 0, 0, MADRID)), 24);
  assert.equal(hours(zonedToUtc(2026, 10, 13, 10, 0, 0, MADRID), zonedToUtc(2026, 10, 14, 9, 0, 0, MADRID)), 23);
  // Overnight splits resolve 04:00 on the next calendar date, which is not start + 24 hours on DST nights.
  for (const [day, iso] of [['2026-03-29', '2026-03-29T02:00:00.000Z'], ['2026-10-25', '2026-10-25T03:00:00.000Z']] as const) {
    const previous = addDays(day, -1);
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const split = zonedToUtc(y, m, d, 4, 0, 0, MADRID);
    assert.equal(split.toISOString(), iso);
    assert.equal(dateKey(split, MADRID), day);
    assert.equal(clockMinutes(split, MADRID), 240);
    const [py, pm, pd] = previous.split('-').map(Number) as [number, number, number];
    const naive = new Date(zonedToUtc(py, pm, pd, 4, 0, 0, MADRID).getTime() + 86_400_000);
    assert.notEqual(clockMinutes(naive, MADRID), 240);
  }
});
