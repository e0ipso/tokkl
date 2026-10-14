import { hasMeridiem, parseTimeOfDay } from '../../../shared/timeOfDay.ts';
import { addDays, dateKey, parseDateKey, zonedToUtc } from '../../../shared/time.ts';

/** Combines a date key and minutes after midnight in `timeZone` into an instant. */
export function instantAt(key: string, minutes: number, timeZone: string): Date {
  const parsed = parseDateKey(key)!;
  return zonedToUtc(parsed.year, parsed.month, parsed.day, Math.floor(minutes / 60), minutes % 60, 0, timeZone);
}

/**
 * Resolves typed start and end times on `day`. The end always lands after the start, rolling over
 * to the next calendar day in `timeZone` when needed, the way Toggl's manual mode works. Only an end
 * without an AM/PM suffix gets the 12-hour guess; an explicit "9am" stays 9 AM.
 */
export function resolveRange(
  day: string, startText: string, endText: string, options: { timeZone: string; twelveHour: boolean; nowMinutes: number },
): { start: Date; stop: Date } | null {
  const startMinutes = parseTimeOfDay(startText, { twelveHour: options.twelveHour, reference: options.nowMinutes });
  if (startMinutes === null) return null;
  let endMinutes = parseTimeOfDay(endText, { twelveHour: options.twelveHour, reference: startMinutes });
  if (endMinutes === null) return null;
  if (options.twelveHour && !hasMeridiem(endText) && endMinutes < startMinutes && endMinutes + 720 > startMinutes && endMinutes < 720) {
    endMinutes += 720;
  }
  const start = instantAt(day, startMinutes, options.timeZone);
  const endDay = endMinutes < startMinutes ? addDays(day, 1) : day;
  return { start, stop: instantAt(endDay, endMinutes, options.timeZone) };
}

export function localDay(iso: string | Date, timeZone: string): string {
  return dateKey(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
}
