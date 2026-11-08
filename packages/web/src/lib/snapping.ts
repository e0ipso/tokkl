import { snapInstant, snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import type { Settings } from './settings.ts';

/** Entry lengths and the times the server stores, as the views preview them before a save. */

type SnapSettings = Pick<Settings, 'timeZone' | 'timeResolution'>;

/** Elapsed seconds for an entry; running entries count up to `now`. */
export function entrySeconds(entry: { start: string; stop: string | null }, now: Date): number {
  const end = entry.stop ? Date.parse(entry.stop) : now.getTime();
  return Math.max(0, Math.floor((end - Date.parse(entry.start)) / 1000));
}

function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * Seconds the server will store for a stopped entry from `start` to `stop`: both cut to whole
 * seconds, then snapped to the time resolution. Zero means the server refuses the span as too short
 * (or `stop` is not after `start`). Use it to preview an entry before saving; a saved entry already
 * holds its snapped times, and a running timer shows real seconds (`entrySeconds`).
 */
export function snappedSeconds(start: Date, stop: Date, settings: SnapSettings): number {
  const span = storedSpan(start, stop, settings);
  return span ? (span.stop.getTime() - span.start.getTime()) / 1000 : 0;
}

/**
 * The start and stop the server will store for a stopped entry from `start` to `stop`, as
 * `snappedSeconds` measures them, or null when it refuses the span as too short.
 */
function storedSpan(start: Date, stop: Date, settings: SnapSettings): SnappedSpan | null {
  const from = wholeSecond(start);
  const to = wholeSecond(stop);
  if (to <= from) return null;
  return snapSpan(from, to, settings.timeResolution, settings.timeZone);
}

/**
 * The grid point of the time resolution nearest `at`, cut to whole seconds first: where the server
 * moves a start or stop it saves. Use it to pick one instant that stays put when either side is saved.
 */
export function snappedInstant(at: Date, settings: SnapSettings): Date {
  return snapInstant(wholeSecond(at), settings.timeResolution, settings.timeZone);
}

export interface SplitHalves {
  first: SnappedSpan;
  second: SnappedSpan;
}

/**
 * The two halves of the stopped entry from `start` to `stop` cut at the grid point nearest `at`, as
 * the server will store them. Both come from the snapped whole, so an entry saved under another
 * resolution splits into halves that add up to what it would store now. Every boundary is a grid
 * point, so the server keeps the halves as they are. The result is `'outside'` when the cut is not
 * strictly inside the snapped whole, or the whole is too short to keep.
 */
export function snappedSplit(start: Date, stop: Date, at: Date, settings: SnapSettings): SplitHalves | 'outside' {
  const whole = snapSpan(wholeSecond(start), wholeSecond(stop), settings.timeResolution, settings.timeZone);
  const cut = snappedInstant(at, settings);
  if (!whole || cut <= whole.start || cut >= whole.stop) return 'outside';
  return { first: { start: whole.start, stop: cut }, second: { start: cut, stop: whole.stop } };
}
