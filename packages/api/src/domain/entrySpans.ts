/**
 * The rules for an entry's start and stop: whole seconds, the instance time resolution on the
 * owner's clock, the 999-hour cap, and the midnight-anchored span of a no-time entry.
 */
import { MAX_ALL_DAY_SECONDS, MAX_DURATION_SECONDS } from '@tokkl/common/duration';
import { snapDuration, snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import { dateKey, startOfDay } from '@tokkl/common/time';
import type { TimeEntry, User } from './model.ts';
import { invalidInput, type ApplicationError } from '../lib/errors.ts';
import type { EntryTimes } from './entryCommands.ts';

export function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** `date` truncated to whole seconds, the precision the database stores. */
export function wholeSeconds(date: Date): Date {
  return new Date(seconds(date) * 1000);
}

export function entryDurationSeconds(row: Pick<TimeEntry, 'start' | 'stop'>, now = new Date()): number {
  return seconds(row.stop ? new Date(row.stop) : now) - seconds(new Date(row.start));
}

/**
 * Snaps a stopped span to the instance resolution on the clock of the owner's timezone, or returns
 * null when it is too short to keep (see `snapSpan`).
 */
export function snapToResolution(resolution: number, user: User, start: Date, stop: Date): SnappedSpan | null {
  return snapSpan(wholeSeconds(start), wholeSeconds(stop), resolution, user.timezone);
}

function tooShort(resolution: number): ApplicationError {
  return invalidInput(`Time entry is too short: it rounds to zero at the ${resolution}-minute time resolution`);
}

/** A timed entry's start: the sent one, moved to `startDate` when sent, else `fallback` on that day. */
export function timedStart(times: EntryTimes, fallback: Date): Date {
  if (times.start) return times.startOnDate ?? times.start;
  const iso = fallback.toISOString();
  return wholeSeconds(new Date(times.startDate ? `${times.startDate}${iso.slice(10)}` : iso));
}

/** A sent stop and a sent duration must agree. */
export function assertConsistentDuration(start: Date, sentStop: Date | undefined, duration: number | undefined): void {
  if (sentStop && duration !== undefined && seconds(sentStop) - seconds(start) !== duration) {
    throw invalidInput('Stop and duration must be consistent with start');
  }
}

export interface Span {
  start: Date;
  stop: Date | null;
}

/**
 * Validates a stopped span and, unless `exact` is set, snaps its start and stop to the instance
 * resolution. A span too short to keep is refused, unless the edit left the stored times alone
 * (`unchanged`): those stay as they are, so an older zero-length entry can still be renamed. The
 * 999-hour cap applies to the snapped span. A running span keeps its exact start.
 */
export function settleSpan(
  resolution: number,
  user: User,
  span: Span,
  { exact = false, unchanged = false } = {},
): Span {
  if (!span.stop) return span;
  if (seconds(span.stop) < seconds(span.start)) throw invalidInput('Stop time must be after start time');
  let settled: Span = span;
  if (!exact) {
    const snapped = snapToResolution(resolution, user, span.start, span.stop);
    if (snapped) settled = snapped;
    else if (!unchanged) throw tooShort(resolution);
  }
  if (seconds(settled.stop!) - seconds(settled.start) > MAX_DURATION_SECONDS) {
    throw invalidInput('Time entries can not be longer than 999 hours');
  }
  return settled;
}

/**
 * The stored span of a no-time entry: local midnight of `day` in the owner's timezone, and that
 * plus the duration. Live writes snap the duration; imports pass `exact`.
 */
export function noTimeSpan(
  resolution: number,
  user: User,
  day: string,
  duration: number,
  { exact = false } = {},
): SnappedSpan {
  if (duration < 0) throw invalidInput('No-time entries can not be running');
  const kept = exact ? Math.trunc(duration) : snapDuration(duration, resolution);
  if (kept <= 0) throw exact ? invalidInput('Time entry is too short') : tooShort(resolution);
  if (kept > MAX_ALL_DAY_SECONDS) throw invalidInput('No-time entries can not be longer than 24 hours');
  const start = startOfDay(day, user.timezone);
  return { start, stop: new Date(start.getTime() + kept * 1000) };
}

/** The span of a new no-time entry: `start_date` or the day of `start`, and `duration` or `stop - start`. */
export function newNoTimeSpan(resolution: number, user: User, times: EntryTimes, exact: boolean): SnappedSpan {
  const { start, stop } = times;
  let duration = times.duration;
  if (start && stop) {
    if (seconds(stop) < seconds(start)) throw invalidInput('Stop time must be after start time');
    assertConsistentDuration(start, stop, duration);
    duration ??= seconds(stop) - seconds(start);
  }
  if (duration === undefined) throw invalidInput('No-time entries need a duration');
  const day = times.startDate ?? dateKey(start ?? new Date(), user.timezone);
  return noTimeSpan(resolution, user, day, duration, { exact });
}

/**
 * The span of a no-time entry after an update. The day is `start_date`, else the local date of
 * `start`, else the entry's own. The duration is `duration`, else `stop - start` when the entry is
 * being turned on, else its own. Once an entry has no times, a `start` must be local midnight and a
 * `stop` must be the anchored stop. An edit that keeps the day and the duration keeps the stored
 * span, so an imported entry off the grid can still be renamed.
 */
export function updatedNoTimeSpan(resolution: number, user: User, current: TimeEntry, times: EntryTimes): SnappedSpan {
  if (!current.stop) throw invalidInput('No-time entries can not be running');
  const wasAllDay = current.allDay;
  const currentStart = new Date(current.start);
  const currentStop = new Date(current.stop);
  const { start, stop } = times;
  let duration = times.duration;
  if (duration !== undefined && duration < 0) throw invalidInput('No-time entries can not be running');
  if (wasAllDay && start && seconds(start) !== seconds(startOfDay(dateKey(start, user.timezone), user.timezone))) {
    throw invalidInput('No-time entries have no start time: change start_date or duration instead');
  }
  if (!wasAllDay && stop) {
    const from = start ?? currentStart;
    if (seconds(stop) < seconds(from)) throw invalidInput('Stop time must be after start time');
    assertConsistentDuration(from, stop, duration);
    duration ??= seconds(stop) - seconds(from);
  }
  const currentDay = dateKey(currentStart, user.timezone);
  const currentDuration = seconds(currentStop) - seconds(currentStart);
  const day = times.startDate ?? (start ? dateKey(start, user.timezone) : currentDay);
  duration ??= currentDuration;
  const span =
    wasAllDay && day === currentDay && duration === currentDuration
      ? { start: currentStart, stop: currentStop }
      : noTimeSpan(resolution, user, day, duration);
  if (wasAllDay && stop && seconds(stop) !== seconds(span.stop)) {
    throw invalidInput('No-time entries have no end time: change duration instead');
  }
  return span;
}
