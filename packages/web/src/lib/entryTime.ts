import { parseTimeOfDay } from '@timetrack/common/timeOfDay';
import { addDays, dateKey, parseDateKey, zonedToUtc } from '@timetrack/common/time';

/** Combines a date key and minutes after midnight in `timeZone` into an instant. */
export function instantAt(key: string, minutes: number, timeZone: string): Date {
  const parsed = parseDateKey(key)!;
  return zonedToUtc(parsed.year, parsed.month, parsed.day, Math.floor(minutes / 60), minutes % 60, 0, timeZone);
}

/**
 * Resolves typed start and end times on `day`. The end always lands after the start, rolling over
 * to the next calendar day in `timeZone` when needed, the way Toggl's manual mode works. For 12-hour
 * users an end without AM/PM is the first occurrence after the start (11pm to "1" is 1 AM); an
 * explicit "9am" stays 9 AM.
 */
export function resolveRange(
  day: string, startText: string, endText: string, options: { timeZone: string; twelveHour: boolean; nowMinutes: number },
): { start: Date; stop: Date } | null {
  const startMinutes = parseTimeOfDay(startText, { twelveHour: options.twelveHour, reference: options.nowMinutes });
  if (startMinutes === null) return null;
  const endMinutes = parseTimeOfDay(endText, { twelveHour: options.twelveHour, after: startMinutes });
  if (endMinutes === null) return null;
  const start = instantAt(day, startMinutes, options.timeZone);
  const endDay = endMinutes < startMinutes ? addDays(day, 1) : day;
  return { start, stop: instantAt(endDay, endMinutes, options.timeZone) };
}

/** The field to fix when resolveRange returns null: the start if it cannot be read, otherwise the end. */
export function unreadableTime(startText: string, options: { twelveHour: boolean; nowMinutes: number }): 'start' | 'end' {
  return parseTimeOfDay(startText, { twelveHour: options.twelveHour, reference: options.nowMinutes }) === null ? 'start' : 'end';
}

export function localDay(iso: string | Date, timeZone: string): string {
  return dateKey(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
}
