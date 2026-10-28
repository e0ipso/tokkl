import { addDays, dateKey } from '@tokkl/common/time';

/**
 * Matches below 760px, where the calendar shows one day at a time. Exactly 760px stays in week
 * mode, while PHONE_QUERY in App.tsx uses max-width: 760px, which includes 760.
 */
export const DAY_MODE_QUERY = '(max-width: 759.98px)';

/** A swipe must travel at least this far sideways to change the day. */
export const SWIPE_MIN_PX = 50;
/** A swipe's sideways travel must also be at least this many times its vertical travel. */
export const SWIPE_RATIO = 1.5;

const DAY_MINUTES = 24 * 60;
/** Calendar drags never step by less than this many minutes. */
const MIN_DRAG_STEP = 15;

export type SwipeDirection = 'next' | 'previous';

/**
 * The step, in minutes, that calendar drags move, resize and create entries in, and the shortest
 * block they leave: the smallest multiple of the time resolution that is at least 15 minutes.
 * Resolutions of 1, 3, 5 and 15 keep 15, 12 gives 24 and 20 gives 20. Every step is a whole number
 * of resolutions, so a boundary on the resolution grid stays on it after any number of steps.
 */
export function dragStep(resolution: number): number {
  return Math.ceil(MIN_DRAG_STEP / resolution) * resolution;
}

/**
 * Where a dragged boundary at clock minute `minute` lands after moving `delta` minutes: the nearest
 * multiple of `resolution`, a tie going later, as snappedInstant in settings.ts drops it. An entry
 * imported off the grid lands on it at the first step. A boundary that has not moved stays put.
 */
export function droppedMinute(minute: number, delta: number, resolution: number): number {
  if (delta === 0) return minute;
  return Math.round((minute + delta) / resolution) * resolution;
}

/**
 * Classifies a finished touch gesture from its travel in pixels. Swiping left goes to the next day
 * and swiping right to the previous one. Short, vertical and diagonal gestures return null, so they
 * stay scrolls.
 */
export function classifySwipe(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'previous';
}

/**
 * Clamps a day-mode move so the block stays on the selected day. `top` and `bottom` are the
 * block's span on that day in clock minutes, from clockSpanOnDay via layout. A block cut off at
 * midnight starts at 0 or ends at 1440, so one that started the day before can't move earlier and
 * one that runs into the next day can't move later. The clamp can shorten a move but never reverses
 * it.
 */
export function clampDayMove(delta: number, top: number, bottom: number): number {
  // 0 - top rather than -top, so a block at midnight gets 0 and not -0.
  const earliest = Math.min(0, 0 - top);
  const latest = Math.max(0, DAY_MINUTES - bottom);
  return Math.min(Math.max(delta, earliest), latest);
}

/**
 * The start to save for a day-mode move. clampDayMove works in clock minutes, but a moved entry
 * keeps its elapsed duration, and on the 25-hour autumn day an entry lasts longer than the clock
 * minutes it covers, so a move the clamp allows can still end after `dayEndMs` (the first instant
 * of the next day). The start then comes back so the entry ends exactly at the day's end. An entry
 * whose original stop was already past the day's end is cut off at midnight on the shown day; it
 * can only move earlier and may still end the next day, so it is left alone.
 */
export function fitMoveInDay(movedStartMs: number, durationMs: number, originalStopMs: number, dayEndMs: number): number {
  if (originalStopMs > dayEndMs || movedStartMs + durationMs <= dayEndMs) return movedStartMs;
  return dayEndMs - durationMs;
}

/**
 * The day `step` days from `day`: ±1 in day mode, ±7 in week mode. Date keys step by calendar
 * day, so the clock changes never skip or repeat a day.
 */
export function stepDay(day: string, step: number): string {
  return addDays(day, step);
}

/**
 * Splits entries for the calendar: `timed` goes to the hour grid, and `allDay` holds each shown
 * day's no-time entries by their local start date. A no-time entry on a day that is not shown is
 * in neither, and a day without chips has no key.
 */
export function splitAllDay<T extends { all_day: boolean; start: string }>(
  entries: T[],
  days: string[],
  timeZone: string,
): { timed: T[]; allDay: Map<string, T[]> } {
  const timed: T[] = [];
  const allDay = new Map<string, T[]>();
  const shown = new Set(days);
  for (const entry of entries) {
    if (!entry.all_day) {
      timed.push(entry);
      continue;
    }
    const day = dateKey(new Date(entry.start), timeZone);
    if (shown.has(day)) allDay.set(day, [...(allDay.get(day) ?? []), entry]);
  }
  return { timed, allDay };
}
