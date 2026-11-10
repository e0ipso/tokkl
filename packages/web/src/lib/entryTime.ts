import { addDays, dateKey, parseDateKey, zonedToUtc } from '@tokkl/common/time';
import { parseTimeOfDay } from '@tokkl/common/timeOfDay';

export function instantAt(key: string, minutes: number, timeZone: string): Date {
  const parsed = parseDateKey(key)!;
  return zonedToUtc(parsed.year, parsed.month, parsed.day, Math.floor(minutes / 60), minutes % 60, 0, timeZone);
}

/** The end always lands after the start, rolling to the next day as Toggl does; a 12-hour end without AM/PM too. */
export function resolveRange(
  day: string,
  startText: string,
  endText: string,
  options: { timeZone: string; twelveHour: boolean; nowMinutes: number },
): { start: Date; stop: Date } | null {
  const startMinutes = parseTimeOfDay(startText, { twelveHour: options.twelveHour, reference: options.nowMinutes });
  if (startMinutes === null) return null;
  const endMinutes = parseTimeOfDay(endText, { twelveHour: options.twelveHour, after: startMinutes });
  if (endMinutes === null) return null;
  const start = instantAt(day, startMinutes, options.timeZone);
  const endDay = endMinutes < startMinutes ? addDays(day, 1) : day;
  return { start, stop: instantAt(endDay, endMinutes, options.timeZone) };
}

/** The start if it cannot be read, otherwise the end. */
export function unreadableTime(
  startText: string,
  options: { twelveHour: boolean; nowMinutes: number },
): 'start' | 'end' {
  return parseTimeOfDay(startText, { twelveHour: options.twelveHour, reference: options.nowMinutes }) === null
    ? 'start'
    : 'end';
}

export function localDay(iso: string | Date, timeZone: string): string {
  return dateKey(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
}
