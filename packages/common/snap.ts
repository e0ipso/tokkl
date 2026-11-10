/** The resolution is the step, in minutes, of the clock grid every stored start and stop lands on. */

import { timeZoneOffsetMs } from './time.ts';

const MINUTE_MS = 60_000;

export interface SnappedSpan {
  start: Date;
  stop: Date;
}

export function isTimeResolution(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && 60 % minutes === 0;
}

/**
 * Each end moves to the nearest grid point on `timeZone`'s wall clock, ties up, with the offset at that point.
 * Null when the span lasted under half a step or both ends snap to the same point.
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

/** Ties go up. */
export function snapDuration(seconds: number, minutes: number): number {
  const step = minutes * 60;
  return Math.floor((Math.trunc(seconds) + step / 2) / step) * step;
}

/** Ties take the later point. */
export function snapInstant(at: Date, minutes: number, timeZone: string): Date {
  if (!isTimeResolution(minutes)) throw new RangeError(`Invalid time resolution: ${minutes}`);
  return new Date(nearestGridPoint(at.getTime(), minutes * MINUTE_MS, timeZone));
}

function gridFloor(time: number, step: number, offset: number): number {
  return Math.floor((time + offset) / step) * step - offset;
}

/**
 * Near an offset change the candidates come from both offsets; each counts only if on the grid with
 * the offset in force at that instant, which also drops wall-clock times a DST gap skips.
 */
function nearestGridPoint(time: number, step: number, timeZone: string): number {
  const offsetAt = (at: number) => timeZoneOffsetMs(new Date(at), timeZone);
  const offsets = [...new Set([time - step, time, time + step].map(offsetAt))];
  if (offsets.length === 1) {
    const below = gridFloor(time, step, offsets[0]!);
    return (time - below) * 2 >= step ? below + step : below;
  }
  return offsets
    .flatMap(offset => {
      const below = gridFloor(time, step, offset);
      return [below - step, below, below + step, below + 2 * step];
    })
    .filter(candidate => gridFloor(candidate, step, offsetAt(candidate)) === candidate)
    .reduce((best, candidate) => {
      const nearer = Math.abs(candidate - time) - Math.abs(best - time);
      return nearer < 0 || (nearer === 0 && candidate > best) ? candidate : best;
    });
}
