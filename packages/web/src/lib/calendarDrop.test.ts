import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeEntry } from '../api/types.ts';
import { dropChange } from './calendarDrop.ts';
import type { CalendarDrag } from './calendarGesture.ts';

const MADRID = 'Europe/Madrid';
const exact = { timeZone: MADRID, timeResolution: 1 };

const entry = (start: string, stop: string | null, id = 5) => ({ id, start, stop }) as TimeEntry;

const creating = (fromMinute: number, toMinute: number, day = '2026-06-22'): CalendarDrag => ({
  kind: 'create',
  day,
  fromMinute,
  toMinute,
});

function dragging(kind: 'move' | 'resize', of: TimeEntry, deltaMinutes: number, day = '2026-06-22'): CalendarDrag {
  return { kind, entry: of, day, originY: 0, startMinute: 0, endMinute: 0, deltaMinutes };
}

test('a create drag makes an entry over the dragged range, whichever way it was dragged', () => {
  // Madrid is two hours ahead of UTC in June.
  const range = { kind: 'create', start: '2026-06-22T07:00:00.000Z', stop: '2026-06-22T08:30:00.000Z' };
  assert.deepEqual(dropChange(creating(540, 630), exact, false), range);
  assert.deepEqual(dropChange(creating(630, 540), exact, false), range);
});

test('a plain click on a slot creates nothing, and a create at midnight keeps one step on the day', () => {
  assert.deepEqual(dropChange(creating(540, 540), exact, false), { kind: 'none' });
  assert.deepEqual(dropChange(creating(1440, 1425), exact, false), {
    kind: 'create',
    start: '2026-06-22T21:45:00.000Z',
    stop: '2026-06-22T21:59:00.000Z',
  });
  // The step follows the resolution: 20 minutes leaves a 20-minute block.
  assert.deepEqual(dropChange(creating(540, 545), { timeZone: MADRID, timeResolution: 20 }, false), {
    kind: 'create',
    start: '2026-06-22T07:00:00.000Z',
    stop: '2026-06-22T07:20:00.000Z',
  });
});

test('a block that did not move opens instead of saving', () => {
  const block = entry('2026-06-22T07:00:00.000Z', '2026-06-22T08:00:00.000Z');
  assert.deepEqual(dropChange(dragging('move', block, 0), exact, false), { kind: 'open', entry: block });
  assert.deepEqual(dropChange(dragging('resize', block, 0), exact, false), { kind: 'open', entry: block });
});

test('a move shifts the start by clock minutes and keeps the stored duration', () => {
  const block = entry('2026-06-22T07:00:00.000Z', '2026-06-22T08:00:00.000Z');
  assert.deepEqual(dropChange(dragging('move', block, 90), exact, false), {
    kind: 'update',
    id: 5,
    start: '2026-06-22T08:30:00.000Z',
    stop: '2026-06-22T09:30:00.000Z',
  });
  // A running entry has no stop to send.
  const running = entry('2026-06-22T07:00:00.000Z', null);
  assert.deepEqual(dropChange(dragging('move', running, -30), exact, false), {
    kind: 'update',
    id: 5,
    start: '2026-06-22T06:30:00.000Z',
  });
});

test('a moved entry off the grid lands on it as the span it would snap to', () => {
  const offGrid = entry('2026-06-22T07:02:00.000Z', '2026-06-22T07:58:00.000Z');
  assert.deepEqual(dropChange(dragging('move', offGrid, 15), { timeZone: MADRID, timeResolution: 5 }, false), {
    kind: 'update',
    id: 5,
    start: '2026-06-22T07:15:00.000Z',
    stop: '2026-06-22T08:15:00.000Z',
  });
});

test('a move crosses the spring clock change by clock minutes, not elapsed time', () => {
  // Madrid skips 02:00 to 03:00 on 2026-03-29: 01:00 local is 00:00Z, and 04:00 local is 02:00Z.
  const night = entry('2026-03-29T00:00:00.000Z', '2026-03-29T00:30:00.000Z');
  assert.deepEqual(dropChange(dragging('move', night, 180, '2026-03-29'), exact, false), {
    kind: 'update',
    id: 5,
    start: '2026-03-29T02:00:00.000Z',
    stop: '2026-03-29T02:30:00.000Z',
  });
});

test('a day-mode move on the 25-hour autumn day keeps the stored stop on the shown day', () => {
  // 00:00 to 03:00 local on 2026-10-25 lasts five hours; the day ends at 23:00Z.
  const early = entry('2026-10-24T22:00:00.000Z', '2026-10-25T03:00:00.000Z');
  assert.deepEqual(dropChange(dragging('move', early, 1200, '2026-10-25'), exact, true), {
    kind: 'update',
    id: 5,
    start: '2026-10-25T18:00:00.000Z',
    stop: '2026-10-25T23:00:00.000Z',
  });
  // The week view lets the same move run past midnight.
  assert.deepEqual(dropChange(dragging('move', early, 1200, '2026-10-25'), exact, false), {
    kind: 'update',
    id: 5,
    start: '2026-10-25T19:00:00.000Z',
    stop: '2026-10-26T00:00:00.000Z',
  });
});

test('a resize moves only the stop, never below one step from the grid start', () => {
  const block = entry('2026-06-22T07:00:00.000Z', '2026-06-22T08:00:00.000Z');
  assert.deepEqual(dropChange(dragging('resize', block, 30), exact, false), {
    kind: 'update',
    id: 5,
    stop: '2026-06-22T08:30:00.000Z',
  });
  assert.deepEqual(dropChange(dragging('resize', block, -60), exact, false), {
    kind: 'update',
    id: 5,
    stop: '2026-06-22T07:15:00.000Z',
  });
  // An off-grid start counts from the grid point the server will move it to.
  const offGrid = entry('2026-06-22T07:02:00.000Z', '2026-06-22T08:00:00.000Z');
  assert.deepEqual(dropChange(dragging('resize', offGrid, -60), { timeZone: MADRID, timeResolution: 5 }, false), {
    kind: 'update',
    id: 5,
    stop: '2026-06-22T07:15:00.000Z',
  });
  // A running entry has no end to drag.
  assert.deepEqual(dropChange(dragging('resize', entry('2026-06-22T07:00:00.000Z', null), 30), exact, false), {
    kind: 'none',
  });
});
