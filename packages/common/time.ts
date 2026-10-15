/**
 * Timezone helpers built on Intl. Instants are stored in UTC; calendar days
 * ("YYYY-MM-DD" keys) are always interpreted in the user's IANA timezone.
 */

import type { ZonedParts } from '@timetrack/types';

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (positive east of UTC). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to an instant. */
export function zonedToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall - timeZoneOffsetMs(new Date(wall), timeZone);
  // A second pass settles guesses that landed on the other side of a DST change.
  guess = wall - timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * First instant of the calendar day `key` in `timeZone`. Where clocks spring forward at midnight
 * (e.g. America/Santiago), 00:00 does not exist and the day starts at the end of the gap.
 */
export function startOfDay(key: string, timeZone: string): Date {
  const parsed = parseDateKey(key);
  if (!parsed) throw new RangeError(`Invalid date: ${key}`);
  const guess = zonedToUtc(parsed.year, parsed.month, parsed.day, 0, 0, 0, timeZone);
  if (dateKey(guess, timeZone) >= key) return guess;
  // The guess fell before the gap. Binary search the first minute that belongs to `key`.
  let low = guess.getTime();
  let high = low + 3 * 3_600_000;
  while (high - low > 60_000) {
    const mid = low + Math.floor((high - low) / 2 / 60_000) * 60_000;
    if (dateKey(new Date(mid), timeZone) >= key) high = mid;
    else low = mid;
  }
  return new Date(high);
}

/** Wall-clock minutes after local midnight in `timeZone`, with seconds as a fraction. */
export function clockMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute + p.second / 60;
}

/**
 * Moves `date` by `minutes` on the local clock of `timeZone`, so 01:00 plus 120 is 03:00 even
 * when the clocks change in between. A result inside a spring gap lands after the gap; one inside
 * the repeated autumn hour resolves as zonedToUtc does.
 */
export function addClockMinutes(date: Date, minutes: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  const shifted = zonedToUtc(p.year, p.month, p.day, p.hour, p.minute + minutes, p.second, timeZone);
  return new Date(shifted.getTime() + date.getUTCMilliseconds());
}

/**
 * Wall-clock position, in minutes after midnight, of the part of [start, stop) that falls on day
 * `key` in `timeZone`; null when the range misses the day. Positions follow the local clock, so a
 * 10:00 entry sits at 600 even on DST days. A start clipped to the day begins at 0 and a stop
 * clipped at the next midnight ends at 1440. Inside the repeated autumn hour, bottom can be lower
 * than top.
 */
export function clockSpanOnDay(
  start: Date, stop: Date, key: string, timeZone: string,
): { top: number; bottom: number } | null {
  const dayStart = startOfDay(key, timeZone).getTime();
  const dayEnd = startOfDay(addDays(key, 1), timeZone).getTime();
  if (stop.getTime() <= dayStart || start.getTime() >= dayEnd) return null;
  return {
    top: start.getTime() < dayStart ? 0 : clockMinutes(start, timeZone),
    bottom: stop.getTime() >= dayEnd ? 24 * 60 : clockMinutes(stop, timeZone),
  };
}

export function addDays(key: string, days: number): string {
  const parsed = parseDateKey(key);
  if (!parsed) throw new RangeError(`Invalid date: ${key}`);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return date.toISOString().slice(0, 10);
}

/** Day of week for a date key, 0 = Sunday. */
export function weekdayOf(key: string): number {
  const parsed = parseDateKey(key);
  if (!parsed) throw new RangeError(`Invalid date: ${key}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** Date key of the first day of the week containing `key`. */
export function startOfWeek(key: string, beginningOfWeek: number): string {
  const diff = (weekdayOf(key) - beginningOfWeek + 7) % 7;
  return addDays(key, -diff);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  if (!a || !b) throw new RangeError('Invalid date');
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
