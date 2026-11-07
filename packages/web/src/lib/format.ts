import { formatDuration } from '@tokkl/common/duration';
import { addDays, dateKey, parseDateKey, zonedParts } from '@tokkl/common/time';
import { localDay } from './entryTime.ts';
import type { Settings } from './settings.ts';

/** Dates, times, durations and money as the account's settings show them. */

export function today(timeZone: string): string {
  return dateKey(new Date(), timeZone);
}

export function formatTime(iso: string | Date, settings: Pick<Settings, 'timeZone' | 'twelveHour'>): string {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, settings.timeZone);
  const minute = String(p.minute).padStart(2, '0');
  if (!settings.twelveHour) return `${String(p.hour).padStart(2, '0')}:${minute}`;
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour}:${minute} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** Minutes after midnight in the account timezone. */
export function minutesOfDay(iso: string | Date, timeZone: string): number {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  return p.hour * 60 + p.minute;
}

export function formatDate(key: string, format: string): string {
  const parsed = parseDateKey(key);
  if (!parsed) return key;
  const dd = String(parsed.day).padStart(2, '0');
  const mm = String(parsed.month).padStart(2, '0');
  return format.replace('YYYY', String(parsed.year)).replace('MM', mm).replace('DD', dd);
}

/** The account-local date of `iso`, in the account's date format. */
export function formatDay(iso: string, settings: Pick<Settings, 'timeZone' | 'dateFormat'>): string {
  return formatDate(localDay(iso, settings.timeZone), settings.dateFormat);
}

/** The account-local date and time of `iso`, such as "2026-03-10 09:30". */
export function formatDateTime(
  iso: string,
  settings: Pick<Settings, 'timeZone' | 'dateFormat' | 'twelveHour'>,
): string {
  return `${formatDay(iso, settings)} ${formatTime(iso, settings)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(key: string): string {
  const parsed = parseDateKey(key)!;
  return WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()]!;
}

export function shortDate(key: string): string {
  const parsed = parseDateKey(key);
  if (!parsed) return key;
  return `${parsed.day} ${MONTHS[parsed.month - 1]}`;
}

export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, -1)) return 'Yesterday';
  const parsed = parseDateKey(key)!;
  const sameYear = todayKey.startsWith(String(parsed.year));
  return `${weekdayName(key)}, ${shortDate(key)}${sameYear ? '' : ` ${parsed.year}`}`;
}

export function duration(seconds: number, settings: Pick<Settings, 'durationFormat'>): string {
  return formatDuration(seconds, settings.durationFormat);
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** A count with its noun, such as "1 entry" or "3 entries". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
