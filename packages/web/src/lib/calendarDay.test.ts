import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addClockMinutes, addDays, clockSpanOnDay, startOfDay, startOfWeek } from '@tokkl/common/time';
import { SWIPE_MIN_PX, SWIPE_RATIO, clampDayMove, classifySwipe, fitMoveInDay, stepDay } from './calendarDay.ts';

const MADRID = 'Europe/Madrid';

test('classifySwipe turns horizontal swipes into day steps', () => {
  // Swiping left brings the next day in from the right.
  assert.equal(classifySwipe(-80, 6), 'next');
  assert.equal(classifySwipe(80, -6), 'previous');
  assert.equal(classifySwipe(-SWIPE_MIN_PX, 0), 'next');
  assert.equal(classifySwipe(SWIPE_MIN_PX, 0), 'previous');
  // Some vertical drift is fine while the swipe stays mostly horizontal.
  assert.equal(classifySwipe(-SWIPE_RATIO * 60, 60), 'next');
});

test('classifySwipe ignores short, vertical and diagonal gestures', () => {
  assert.equal(classifySwipe(0, 0), null);
  assert.equal(classifySwipe(SWIPE_MIN_PX - 1, 0), null);
  assert.equal(classifySwipe(-(SWIPE_MIN_PX - 1), 0), null);
  // A vertical scroll that wanders sideways is still a scroll.
  assert.equal(classifySwipe(30, 400), null);
  assert.equal(classifySwipe(-120, -300), null);
  // A 45 degree drag is ambiguous, so it does nothing.
  assert.equal(classifySwipe(-90, 90), null);
  assert.equal(classifySwipe(SWIPE_RATIO * 60 - 1, 60), null);
});

test('clampDayMove keeps a moved block inside the selected day', () => {
  // 09:00 to 10:00.
  assert.equal(clampDayMove(-60, 540, 600), -60);
  assert.equal(clampDayMove(180, 540, 600), 180);
  assert.equal(clampDayMove(-600, 540, 600), -540);
  assert.equal(clampDayMove(900, 540, 600), 840);
  // A block already at an edge stays put when dragged past it.
  assert.equal(clampDayMove(-30, 0, 60), 0);
  assert.equal(clampDayMove(30, 1380, 1440), 0);
});

test('clampDayMove pins the edges of blocks cut off at midnight', () => {
  // 23:00 on the 17th to 01:00 on the 18th, Madrid time.
  const start = new Date('2026-10-17T21:00:00Z');
  const stop = new Date('2026-10-17T23:00:00Z');
  // On the 18th it started the day before, so it can move later but not earlier.
  const fromYesterday = clockSpanOnDay(start, stop, '2026-10-18', MADRID)!;
  assert.deepEqual(fromYesterday, { top: 0, bottom: 60 });
  assert.equal(clampDayMove(-15, fromYesterday.top, fromYesterday.bottom), 0);
  assert.equal(clampDayMove(60, fromYesterday.top, fromYesterday.bottom), 60);
  assert.equal(clampDayMove(2000, fromYesterday.top, fromYesterday.bottom), 1380);
  // On the 17th it runs into the next day, so it can move earlier but not later.
  const intoTomorrow = clockSpanOnDay(start, stop, '2026-10-17', MADRID)!;
  assert.deepEqual(intoTomorrow, { top: 1380, bottom: 1440 });
  assert.equal(clampDayMove(15, intoTomorrow.top, intoTomorrow.bottom), 0);
  assert.equal(clampDayMove(-60, intoTomorrow.top, intoTomorrow.bottom), -60);
  assert.equal(clampDayMove(-2000, intoTomorrow.top, intoTomorrow.bottom), -1380);
  // A block covering the whole day can't move at all.
  assert.equal(clampDayMove(-45, 0, 1440), 0);
  assert.equal(clampDayMove(45, 0, 1440), 0);
});

test('clampDayMove never pushes a block against the drag', () => {
  // Layout makes every block at least 5 minutes tall, so one at 23:58 reaches past 24:00. An
  // unmoved drag must still be 0, or a plain click would move the entry.
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
  // The pulled-back start is still later than where the entry came from.
  assert.ok(fitted > start.getTime());
});

test('fitMoveInDay leaves a move alone when the entry still ends on the shown day', () => {
  const dayEnd = startOfDay('2026-10-26', MADRID).getTime();
  const start = new Date('2026-10-24T22:00:00Z');
  const stop = new Date('2026-10-25T03:00:00Z');
  const duration = stop.getTime() - start.getTime();
  // 600 clock minutes down is 10:00 to 15:00 CET.
  const tenOClock = addClockMinutes(start, 600, MADRID).getTime();
  assert.equal(fitMoveInDay(tenOClock, duration, stop.getTime(), dayEnd), tenOClock);
  // A move that ends exactly at midnight already fits.
  const flush = dayEnd - duration;
  assert.equal(fitMoveInDay(flush, duration, stop.getTime(), dayEnd), flush);
  // Moving earlier never needs a correction.
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
  // Saturday only lets it move earlier; it still ends on Sunday and must not be pulled back.
  const earlier = addClockMinutes(start, -60, MADRID).getTime();
  assert.ok(earlier + duration > dayEnd);
  assert.equal(fitMoveInDay(earlier, duration, stop.getTime(), dayEnd), earlier);
});

test('stepDay crosses into the adjacent week for either first weekday', () => {
  // 2026-10-18 is a Sunday.
  // With Monday-first weeks, Sunday is the last day, so the next day opens the following week.
  assert.equal(startOfWeek('2026-10-18', 1), '2026-10-12');
  assert.equal(stepDay('2026-10-18', 1), '2026-10-19');
  assert.equal(startOfWeek(stepDay('2026-10-18', 1), 1), '2026-10-19');
  assert.equal(startOfWeek(stepDay('2026-10-19', -1), 1), '2026-10-12');
  // With Sunday-first weeks, Sunday is the first day, so the previous day opens the week before.
  assert.equal(startOfWeek('2026-10-18', 0), '2026-10-18');
  assert.equal(stepDay('2026-10-18', -1), '2026-10-17');
  assert.equal(startOfWeek(stepDay('2026-10-18', -1), 0), '2026-10-11');
  assert.equal(startOfWeek(stepDay('2026-10-17', 1), 0), '2026-10-18');
  // A seven-day step shows the same week as moving the week start by seven days.
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
  // 2026-03-29 lasts 23 hours in Madrid and 2026-10-25 lasts 25. Adding 24 hours to local midnight
  // would skip back from the 30th to the 28th of March and stay on the 25th of October.
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
