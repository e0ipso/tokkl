import { clockSpanOnDay } from '@tokkl/common/time';
import type { TimeEntry } from '@tokkl/types';
import { assignLanes, heightClearingMarkers } from './calendarLanes.ts';
import { localDay } from './entryTime.ts';
import { entrySeconds } from './snapping.ts';

/** styles/calendar.css hour lines and `HOUR` in e2e/history-calendar-tests-helpers.ts must change with it. */
export const HOUR_HEIGHT = 48;
/** So a zero-length entry is a thin bar at its start. */
export const MIN_BLOCK_HEIGHT = 6;
export const DAY_MINUTES = 24 * 60;

export function minuteToPx(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT;
}

export function pxToMinute(px: number): number {
  return (px / HOUR_HEIGHT) * 60;
}

/** Kept on the day. */
export function snapMinute(minutes: number, step: number): number {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes / step) * step));
}

export interface CalendarBlock {
  entry: TimeEntry;
  day: string;
  /** Clock minutes of the part on `day`. */
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  minHeight: number;
}

/** Side by side where stored spans overlap; a running entry runs to `now`. */
export function layoutBlocks(
  entries: readonly TimeEntry[],
  days: readonly string[],
  timeZone: string,
  now: Date,
): Map<string, CalendarBlock[]> {
  const byDay = new Map<string, CalendarBlock[]>();
  for (const day of days) {
    const onDay = entries.flatMap((entry): CalendarBlock[] => {
      const span = clockSpanOnDay(new Date(entry.start), entry.stop ? new Date(entry.stop) : now, day, timeZone);
      return span
        ? [{ entry, day, top: span.top, bottom: span.bottom, lane: 0, lanes: 1, minHeight: MIN_BLOCK_HEIGHT }]
        : [];
    });
    const laid = assignLanes(onDay);
    for (const block of laid) block.minHeight = heightClearingMarkers(block, laid, HOUR_HEIGHT / 60, MIN_BLOCK_HEIGHT);
    byDay.set(day, laid);
  }
  return byDay;
}

/** Running entries up to `now`; days without entries are absent. */
export function dayTotals(entries: readonly TimeEntry[], timeZone: string, now: Date): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const day = localDay(entry.start, timeZone);
    totals.set(day, (totals.get(day) ?? 0) + entrySeconds(entry, now));
  }
  return totals;
}

/** Both ends included. */
export function rangeTotal(totals: ReadonlyMap<string, number>, first: string, last: string): number {
  let sum = 0;
  for (const [day, seconds] of totals) if (day >= first && day <= last) sum += seconds;
  return sum;
}
