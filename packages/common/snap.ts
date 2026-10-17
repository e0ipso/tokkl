/**
 * Snapping a time entry to a resolution: the step, in minutes, that every stored duration is a
 * multiple of. Shared by the server, which snaps on write, and the web app.
 */

import { timeZoneOffsetMs } from './time.ts';

const MINUTE_MS = 60_000;

export interface SnappedSpan {
  start: Date;
  stop: Date;
}

/** True for the resolutions that divide an hour evenly: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 and 60. */
export function isTimeResolution(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && 60 % minutes === 0;
}

/**
 * Snaps the span from `start` to `stop` to a resolution of `minutes`, which must divide 60.
 *
 * The duration rounds up to a multiple of the resolution: it never shrinks, it gains less than one
 * step, and a duration that is already a multiple stays as it is. The start moves to the nearest
 * point of the grid on the wall clock of `timeZone`, rounding a tie up. Because the resolution
 * divides an hour, the grid falls on every whole hour, also in zones 30 or 45 minutes off UTC.
 * Near a DST change each grid point uses the offset in force at that point, so a change of half an
 * hour, as on Lord Howe Island, never leaves the start off the clock grid.
 * The stop is the snapped start plus the rounded duration, counted in elapsed time, so a span
 * across a DST change keeps its duration.
 */
export function snapSpan(start: Date, stop: Date, minutes: number, timeZone: string): SnappedSpan {
  if (!isTimeResolution(minutes)) throw new RangeError(`Invalid time resolution: ${minutes}`);
  const elapsed = stop.getTime() - start.getTime();
  if (!(elapsed >= 0)) throw new RangeError('Stop must not be before start');
  const step = minutes * MINUTE_MS;
  const duration = Math.ceil(elapsed / step) * step;
  const snappedStart = nearestGridPoint(start.getTime(), step, timeZone);
  return { start: new Date(snappedStart), stop: new Date(snappedStart + duration) };
}

/** The last instant at or before `time` whose wall-clock time is a multiple of `step` at `offset`. */
function gridFloor(time: number, step: number, offset: number): number {
  return Math.floor((time + offset) / step) * step - offset;
}

/**
 * The instant nearest `time` whose wall-clock time in `timeZone` is a multiple of `step`, taking
 * the later one on a tie. Without an offset change within a step of `time`, the grid points on
 * either side share the offset at `time`. Otherwise the candidates come from the offsets on both
 * sides of the change, and each one counts only if it is on the grid with the offset in force at
 * that instant, which also drops wall-clock times that a DST gap skips.
 */
function nearestGridPoint(time: number, step: number, timeZone: string): number {
  const offsetAt = (at: number) => timeZoneOffsetMs(new Date(at), timeZone);
  const offsets = [...new Set([time - step, time, time + step].map(offsetAt))];
  if (offsets.length === 1) {
    const below = gridFloor(time, step, offsets[0]!);
    return (time - below) * 2 >= step ? below + step : below;
  }
  return offsets
    .flatMap((offset) => {
      const below = gridFloor(time, step, offset);
      return [below - step, below, below + step, below + 2 * step];
    })
    .filter((candidate) => gridFloor(candidate, step, offsetAt(candidate)) === candidate)
    .reduce((best, candidate) => {
      const nearer = Math.abs(candidate - time) - Math.abs(best - time);
      return nearer < 0 || (nearer === 0 && candidate > best) ? candidate : best;
    });
}
