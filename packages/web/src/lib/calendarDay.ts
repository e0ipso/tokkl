import { addDays, dateKey } from '@tokkl/common/time';

/** Below 760px; exactly 760px stays in week mode, unlike PHONE_QUERY in App.tsx. */
export const DAY_MODE_QUERY = '(max-width: 759.98px)';

export const SWIPE_MIN_PX = 50;
/** Sideways travel must also be this many times the vertical travel. */
export const SWIPE_RATIO = 1.5;

const DAY_MINUTES = 24 * 60;
const MIN_DRAG_STEP = 15;

export type SwipeDirection = 'next' | 'previous';

/** The smallest multiple of the resolution that is at least 15 minutes, so steps keep boundaries on the grid. */
export function dragStep(resolution: number): number {
  return Math.ceil(MIN_DRAG_STEP / resolution) * resolution;
}

/** Nearest multiple of `resolution`, ties later, as snappedInstant does; an unmoved boundary stays put. */
export function droppedMinute(minute: number, delta: number, resolution: number): number {
  if (delta === 0) return minute;
  return Math.round((minute + delta) / resolution) * resolution;
}

/** Left is the next day. Short, vertical and diagonal gestures return null, so they stay scrolls. */
export function classifySwipe(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'previous';
}

/** Keeps the block on the selected day; a block cut at midnight cannot move past it. Never reverses a move. */
export function clampDayMove(delta: number, top: number, bottom: number): number {
  // 0 - top rather than -top, so a block at midnight gets 0 and not -0.
  const earliest = Math.min(0, 0 - top);
  const latest = Math.max(0, DAY_MINUTES - bottom);
  return Math.min(Math.max(delta, earliest), latest);
}

/** On the 25-hour autumn day a clamped move can still end after `dayEndMs`; the start then comes back to fit. */
export function fitMoveInDay(
  movedStartMs: number,
  durationMs: number,
  originalStopMs: number,
  dayEndMs: number,
): number {
  if (originalStopMs > dayEndMs || movedStartMs + durationMs <= dayEndMs) return movedStartMs;
  return dayEndMs - durationMs;
}

/** Date keys step by calendar day, so clock changes never skip or repeat a day. */
export function stepDay(day: string, step: number): string {
  return addDays(day, step);
}

/** A no-time entry on a day not shown is in neither, and a day without chips has no key. */
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
