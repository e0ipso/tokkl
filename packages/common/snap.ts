/**
 * Snapping a time entry to a resolution: the step, in minutes, of the clock grid that every stored
 * start and stop lands on. Shared by the server, which snaps on write, and the web app.
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
 * Snaps the span from `start` to `stop` to a resolution of `minutes`, which must divide 60, or
 * returns null when the span is too short to keep.
 *
 * The start and the stop each move to the nearest point of the grid on the wall clock of
 * `timeZone`, rounding a tie up, so either end moves by at most half a step and two spans that
 * meet still meet once snapped. Because the resolution divides an hour, the grid falls on every
 * whole hour, also in zones 30 or 45 minutes off UTC. Near a DST change each grid point uses the
 * offset in force at that point, so a change of half an hour, as on Lord Howe Island, never leaves
 * an end off the clock grid.
 *
 * A span is too short when it lasted less than half a step, or when both ends snap to the same
 * point. The first catches a timer started by accident even when it straddles a half-step mark.
 */
export function snapSpan(start: Date, stop: Date, minutes: number, timeZone: string): SnappedSpan | null {
  if (!isTimeResolution(minutes)) throw new RangeError(`Invalid time resolution: ${minutes}`);
  const elapsed = stop.getTime() - start.getTime();
  if (!(elapsed >= 0)) throw new RangeError('Stop must not be before start');
  const step = minutes * MINUTE_MS;
  if (elapsed * 2 < step) return null;
  const snappedStart = snapInstant(start, minutes, timeZone);
  const snappedStop = snapInstant(stop, minutes, timeZone);
  return snappedStop > snappedStart ? { start: snappedStart, stop: snappedStop } : null;
}

/** The grid point of a resolution of `minutes` nearest `at` on the wall clock of `timeZone`, the later one on a tie. */
export function snapInstant(at: Date, minutes: number, timeZone: string): Date {
  if (!isTimeResolution(minutes)) throw new RangeError(`Invalid time resolution: ${minutes}`);
  return new Date(nearestGridPoint(at.getTime(), minutes * MINUTE_MS, timeZone));
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
