import { snapInstant, snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import type { Settings } from './settings.ts';

type SnapSettings = Pick<Settings, 'timeZone' | 'timeResolution'>;

/** Running entries count up to `now`. */
export function entrySeconds(entry: { start: string; stop: string | null }, now: Date): number {
  const end = entry.stop ? Date.parse(entry.stop) : now.getTime();
  return Math.max(0, Math.floor((end - Date.parse(entry.start)) / 1000));
}

function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/** Whole seconds, then snapped; zero means the server refuses the span. Saved entries already hold snapped times. */
export function snappedSeconds(start: Date, stop: Date, settings: SnapSettings): number {
  const span = storedSpan(start, stop, settings);
  return span ? (span.stop.getTime() - span.start.getTime()) / 1000 : 0;
}

/** Null when too short. */
function storedSpan(start: Date, stop: Date, settings: SnapSettings): SnappedSpan | null {
  const from = wholeSecond(start);
  const to = wholeSecond(stop);
  if (to <= from) return null;
  return snapSpan(from, to, settings.timeResolution, settings.timeZone);
}

/** Cut to whole seconds first: where the server moves a start or stop it saves. */
export function snappedInstant(at: Date, settings: SnapSettings): Date {
  return snapInstant(wholeSecond(at), settings.timeResolution, settings.timeZone);
}

export interface SplitHalves {
  first: SnappedSpan;
  second: SnappedSpan;
}

/** Both halves come from the snapped whole, so they add up; `'outside'` when the cut is not strictly inside it. */
export function snappedSplit(start: Date, stop: Date, at: Date, settings: SnapSettings): SplitHalves | 'outside' {
  const whole = snapSpan(wholeSecond(start), wholeSecond(stop), settings.timeResolution, settings.timeZone);
  const cut = snappedInstant(at, settings);
  if (!whole || cut <= whole.start || cut >= whole.stop) return 'outside';
  return { first: { start: whole.start, stop: cut }, second: { start: cut, stop: whole.stop } };
}
