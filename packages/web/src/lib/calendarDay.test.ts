import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addClockMinutes, addDays, clockMinutes, clockSpanOnDay, startOfDay, startOfWeek } from '@tokkl/common/time';
import {
  SWIPE_MIN_PX,
  SWIPE_RATIO,
  clampDayMove,
  classifySwipe,
  dragStep,
  droppedMinute,
  fitMoveInDay,
  splitAllDay,
  stepDay,
} from './calendarDay.ts';
import { snappedInstant } from './snapping.ts';

const MADRID = 'Europe/Madrid';

test('classifySwipe turns horizontal swipes into day steps', () => {
  assert.equal(classifySwipe(-80, 6), 'next');
  assert.equal(classifySwipe(80, -6), 'previous');
  assert.equal(classifySwipe(-SWIPE_MIN_PX, 0), 'next');
  assert.equal(classifySwipe(SWIPE_MIN_PX, 0), 'previous');
  assert.equal(classifySwipe(-SWIPE_RATIO * 60, 60), 'next');
});

test('classifySwipe ignores short, vertical and diagonal gestures', () => {
  assert.equal(classifySwipe(0, 0), null);
  assert.equal(classifySwipe(SWIPE_MIN_PX - 1, 0), null);
  assert.equal(classifySwipe(-(SWIPE_MIN_PX - 1), 0), null);
  assert.equal(classifySwipe(30, 400), null);
  assert.equal(classifySwipe(-120, -300), null);
  // A 45 degree drag is ambiguous, so it does nothing.
  assert.equal(classifySwipe(-90, 90), null);
  assert.equal(classifySwipe(SWIPE_RATIO * 60 - 1, 60), null);
});

test('clampDayMove keeps a moved block inside the selected day', () => {
  assert.equal(clampDayMove(-60, 540, 600), -60);
  assert.equal(clampDayMove(180, 540, 600), 180);
  assert.equal(clampDayMove(-600, 540, 600), -540);
  assert.equal(clampDayMove(900, 540, 600), 840);
  assert.equal(clampDayMove(-30, 0, 60), 0);
  assert.equal(clampDayMove(30, 1380, 1440), 0);
});

test('clampDayMove pins the edges of blocks cut off at midnight', () => {
  // 23:00 on the 17th to 01:00 on the 18th, Madrid time.
  const start = new Date('2026-10-17T21:00:00Z');
  const stop = new Date('2026-10-17T23:00:00Z');
  const fromYesterday = clockSpanOnDay(start, stop, '2026-10-18', MADRID)!;
  assert.deepEqual(fromYesterday, { top: 0, bottom: 60 });
  assert.equal(clampDayMove(-15, fromYesterday.top, fromYesterday.bottom), 0);
  assert.equal(clampDayMove(60, fromYesterday.top, fromYesterday.bottom), 60);
  assert.equal(clampDayMove(2000, fromYesterday.top, fromYesterday.bottom), 1380);
  const intoTomorrow = clockSpanOnDay(start, stop, '2026-10-17', MADRID)!;
  assert.deepEqual(intoTomorrow, { top: 1380, bottom: 1440 });
  assert.equal(clampDayMove(15, intoTomorrow.top, intoTomorrow.bottom), 0);
  assert.equal(clampDayMove(-60, intoTomorrow.top, intoTomorrow.bottom), -60);
  assert.equal(clampDayMove(-2000, intoTomorrow.top, intoTomorrow.bottom), -1380);
  assert.equal(clampDayMove(-45, 0, 1440), 0);
  assert.equal(clampDayMove(45, 0, 1440), 0);
});

test('clampDayMove never pushes a block against the drag', () => {
  // Layout makes blocks at least 5 minutes tall, so one at 23:58 passes 24:00; an unmoved drag must stay 0.
  assert.equal(clampDayMove(0, 1438, 1443), 0);
  assert.equal(clampDayMove(15, 1438, 1443), 0);
  assert.equal(clampDayMove(-15, 1438, 1443), -15);
});

test('fitMoveInDay pulls a move back so the entry ends at midnight on the Madrid autumn clock change', () => {
  // Sunday 2026-10-25 lasts 25 hours in Madrid: the day ends at 23:00Z, not 22:00Z.
  const dayEnd = startOfDay('2026-10-26', MADRID).getTime();
  assert.equal(dayEnd - startOfDay('2026-10-25', MADRID).getTime(), 25 * 3_600_000);
  // 00:00 CEST to 04:00 CET: 240 clock minutes, but five elapsed hours.
  const start = new Date('2026-10-24T22:00:00Z');
  const stop = new Date('2026-10-25T03:00:00Z');
  const duration = stop.getTime() - start.getTime();
  assert.equal(duration, 5 * 3_600_000);
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-10-25', MADRID), { top: 0, bottom: 240 });

  // 1200 clock minutes down passes clampDayMove, but 20:00 plus five hours is 01:00 on Monday.
  const movedStart = addClockMinutes(start, 1200, MADRID).getTime();
  assert.equal(new Date(movedStart).toISOString(), '2026-10-25T19:00:00.000Z');
  assert.ok(movedStart + duration > dayEnd);
  const fitted = fitMoveInDay(movedStart, duration, stop.getTime(), dayEnd);
  assert.equal(new Date(fitted).toISOString(), '2026-10-25T18:00:00.000Z');
  assert.equal(fitted + duration, dayEnd);
  assert.ok(fitted > start.getTime());
});

test('fitMoveInDay leaves a move alone when the entry still ends on the shown day', () => {
  const dayEnd = startOfDay('2026-10-26', MADRID).getTime();
  const start = new Date('2026-10-24T22:00:00Z');
  const stop = new Date('2026-10-25T03:00:00Z');
  const duration = stop.getTime() - start.getTime();
  const tenOClock = addClockMinutes(start, 600, MADRID).getTime();
  assert.equal(fitMoveInDay(tenOClock, duration, stop.getTime(), dayEnd), tenOClock);
  const flush = dayEnd - duration;
  assert.equal(fitMoveInDay(flush, duration, stop.getTime(), dayEnd), flush);
  const earlier = addClockMinutes(start, -60, MADRID).getTime();
  assert.equal(fitMoveInDay(earlier, duration, stop.getTime(), dayEnd), earlier);
});

test('fitMoveInDay leaves an entry that already ran past midnight alone', () => {
  // 23:00 CEST on Saturday the 24th to 04:00 CET on Sunday the 25th, shown on Saturday.
  const dayEnd = startOfDay('2026-10-25', MADRID).getTime();
  const start = new Date('2026-10-24T21:00:00Z');
  const stop = new Date('2026-10-25T03:00:00Z');
  const duration = stop.getTime() - start.getTime();
  assert.deepEqual(clockSpanOnDay(start, stop, '2026-10-24', MADRID), { top: 1380, bottom: 1440 });
  assert.ok(stop.getTime() > dayEnd);
  const earlier = addClockMinutes(start, -60, MADRID).getTime();
  assert.ok(earlier + duration > dayEnd);
  assert.equal(fitMoveInDay(earlier, duration, stop.getTime(), dayEnd), earlier);
});

test('stepDay crosses into the adjacent week for either first weekday', () => {
  // 2026-10-18 is a Sunday.
  assert.equal(startOfWeek('2026-10-18', 1), '2026-10-12');
  assert.equal(stepDay('2026-10-18', 1), '2026-10-19');
  assert.equal(startOfWeek(stepDay('2026-10-18', 1), 1), '2026-10-19');
  assert.equal(startOfWeek(stepDay('2026-10-19', -1), 1), '2026-10-12');
  assert.equal(startOfWeek('2026-10-18', 0), '2026-10-18');
  assert.equal(stepDay('2026-10-18', -1), '2026-10-17');
  assert.equal(startOfWeek(stepDay('2026-10-18', -1), 0), '2026-10-11');
  assert.equal(startOfWeek(stepDay('2026-10-17', 1), 0), '2026-10-18');
  for (const beginningOfWeek of [0, 1]) {
    for (const step of [7, -7]) {
      assert.equal(
        startOfWeek(stepDay('2026-10-21', step), beginningOfWeek),
        addDays(startOfWeek('2026-10-21', beginningOfWeek), step),
      );
    }
  }
});

test('stepDay lands on every day across the Madrid clock changes', () => {
  // 2026-03-29 lasts 23 hours in Madrid and 2026-10-25 lasts 25, so adding 24 hours to midnight would go wrong.
  const spring = ['2026-03-28', '2026-03-29', '2026-03-30'];
  const autumn = ['2026-10-24', '2026-10-25', '2026-10-26'];
  for (const days of [spring, autumn]) {
    assert.equal(stepDay(days[0]!, 1), days[1]);
    assert.equal(stepDay(days[1]!, 1), days[2]);
    assert.equal(stepDay(days[2]!, -1), days[1]);
    assert.equal(stepDay(days[1]!, -1), days[0]);
  }
  assert.equal(stepDay('2026-10-19', 7), '2026-10-26');
});

test('dragStep is the smallest multiple of the resolution that is at least 15 minutes', () => {
  const steps: Record<number, number> = {
    1: 15,
    2: 16,
    3: 15,
    4: 16,
    5: 15,
    6: 18,
    10: 20,
    12: 24,
    15: 15,
    20: 20,
    30: 30,
    60: 60,
  };
  for (const [resolution, step] of Object.entries(steps)) {
    assert.equal(dragStep(Number(resolution)), step, `resolution ${resolution}`);
    assert.equal(step % Number(resolution), 0, `resolution ${resolution}`);
  }
});

test('droppedMinute keeps an on-grid boundary on the grid and lands an off-grid one on it', () => {
  assert.equal(droppedMinute(9 * 60, dragStep(5), 5), 9 * 60 + 15);
  assert.equal(droppedMinute(9 * 60 + 7, dragStep(5), 5), 9 * 60 + 20);
  // At 12, the bottom of 09:00-09:12 goes one 24-minute step to 09:36.
  assert.equal(droppedMinute(9 * 60 + 12, dragStep(12), 12), 9 * 60 + 36);
  // An imported 09:07 start moved two steps reaches 09:55 and lands on 10:00.
  assert.equal(droppedMinute(9 * 60 + 7, 2 * dragStep(12), 12), 10 * 60);
  assert.equal(droppedMinute(9 * 60 + 7, -dragStep(12), 12), 8 * 60 + 48);
  // Halfway between two grid points the later one wins, as on the server.
  assert.equal(droppedMinute(6, 24, 12), 36);
  assert.equal(droppedMinute(9 * 60 + 7, 0, 12), 9 * 60 + 7);
});

test('droppedMinute shows the clock minute that snappedInstant drops the boundary on', () => {
  for (const from of ['2026-06-17T07:00:00Z', '2026-06-17T07:07:30Z']) {
    const boundary = new Date(from);
    for (const resolution of [1, 2, 5, 6, 12, 20, 60]) {
      const settings = { timeZone: MADRID, timeResolution: resolution };
      for (const steps of [-2, -1, 1, 3]) {
        const delta = steps * dragStep(resolution);
        const dropped = snappedInstant(addClockMinutes(boundary, delta, MADRID), settings);
        assert.equal(
          droppedMinute(clockMinutes(boundary, MADRID), delta, resolution),
          clockMinutes(dropped, MADRID),
          `${from}, resolution ${resolution}, ${steps} steps`,
        );
      }
    }
  }
});

test('splitAllDay keeps no-time entries out of the grid list and groups them by local start date', () => {
  const entry = (id: number, start: string, all_day: boolean) => ({ id, start, all_day });
  const midnight = entry(1, '2026-06-16T22:00:00Z', true); // 2026-06-17 00:00 in Madrid
  const timed = entry(2, '2026-06-17T07:00:00Z', false);
  const sameDay = entry(3, '2026-06-17T22:00:00Z', true); // 2026-06-18 00:00 in Madrid
  const elsewhere = entry(4, '2026-06-25T22:00:00Z', true);
  const days = ['2026-06-17', '2026-06-18'];
  const { timed: grid, allDay } = splitAllDay([midnight, timed, sameDay, elsewhere], days, MADRID);
  assert.deepEqual(grid, [timed]);
  assert.deepEqual(allDay.get('2026-06-17'), [midnight]);
  assert.deepEqual(allDay.get('2026-06-18'), [sameDay]);
  assert.deepEqual(splitAllDay([midnight], ['2026-06-16', '2026-06-17'], 'America/New_York').allDay.get('2026-06-16'), [
    midnight,
  ]);
  assert.equal(allDay.has('2026-06-19'), false);
  assert.equal(splitAllDay([timed], days, MADRID).allDay.size, 0);
});
