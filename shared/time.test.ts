import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateKey, startOfDay, startOfWeek, zonedToUtc } from './time.ts';

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
