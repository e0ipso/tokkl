import { formatDuration } from '@tokkl/common/duration';
import { addDays, dateKey, parseDateKey, zonedParts } from '@tokkl/common/time';
import { LOCALE, NUMBER_LOCALE } from '../i18n/locale.ts';
import { t } from '../i18n/messages.ts';
import { localDay } from './entryTime.ts';
import type { Settings } from './settings.ts';

/**
 * Dates, times, durations and money as the account's settings show them. Names of weekdays,
 * months, day periods and relative days come from `Intl` in the interface locale; the catalog's
 * `dates` patterns put the parts together.
 */

// Date keys and hours are formatted as UTC instants, so no time zone can move them to another day.
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const longWeekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' });
const longMonthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' });
const dayPeriodFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' });
const relativeDays = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
const countFormat = new Intl.NumberFormat(NUMBER_LOCALE);

/** Midnight UTC on a calendar date, for formatting its date parts. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** The text with its first letter in upper case, for a name that starts a label. */
function sentenceStart(text: string): string {
  return text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);
}

/** "AM" or "PM" for an hour of the day, from 0 to 23. */
function dayPeriod(hour: number): string {
  const parts = dayPeriodFormat.formatToParts(new Date(Date.UTC(2000, 0, 1, hour)));
  return parts.find(part => part.type === 'dayPeriod')?.value ?? '';
}

export function today(timeZone: string): string {
  return dateKey(new Date(), timeZone);
}

export function formatTime(iso: string | Date, settings: Pick<Settings, 'timeZone' | 'twelveHour'>): string {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, settings.timeZone);
  const minute = String(p.minute).padStart(2, '0');
  if (!settings.twelveHour) return t('dates.time24', { hour: String(p.hour).padStart(2, '0'), minute });
  const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return t('dates.time12', { hour, minute, period: dayPeriod(p.hour) });
}

/** Minutes after midnight in the account timezone. */
export function minutesOfDay(iso: string | Date, timeZone: string): number {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  return p.hour * 60 + p.minute;
}

/** A date key in the account's date format, such as "DD/MM/YYYY". The format is not localised. */
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
  return t('dates.dateTime', { date: formatDay(iso, settings), time: formatTime(iso, settings) });
}

/** The short weekday name of a date key, such as "Mon". */
export function weekdayName(key: string): string {
  const parsed = parseDateKey(key)!;
  return weekdayFormat.format(utcDay(parsed.year, parsed.month, parsed.day));
}

/** The full name of a day of the week, from 0 for Sunday to 6 for Saturday. */
export function dayOfWeekName(day: number): string {
  // 1 January 2023 was a Sunday.
  return longWeekdayFormat.format(utcDay(2023, 1, 1 + day));
}

/** The name of a month from 1 to 12: "January", or "Jan" when short. */
export function monthName(month: number, width: 'long' | 'short' = 'long'): string {
  return (width === 'long' ? longMonthFormat : monthFormat).format(utcDay(2000, month, 1));
}

/** A date key as a day and a short month name, such as "22 Jun". */
export function shortDate(key: string): string {
  const parsed = parseDateKey(key);
  if (!parsed) return key;
  const month = monthFormat.format(utcDay(parsed.year, parsed.month, parsed.day));
  return t('dates.shortDate', { day: parsed.day, month });
}

/** A day heading: "Today", "Yesterday", or the weekday and date, with the year when it differs. */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return sentenceStart(relativeDays.format(0, 'day'));
  if (key === addDays(todayKey, -1)) return sentenceStart(relativeDays.format(-1, 'day'));
  const parsed = parseDateKey(key)!;
  const weekday = weekdayName(key);
  const date = shortDate(key);
  return todayKey.startsWith(String(parsed.year))
    ? t('dates.dayLabel', { weekday, date })
    : t('dates.dayLabelWithYear', { weekday, date, year: parsed.year });
}

export function duration(seconds: number, settings: Pick<Settings, 'durationFormat'>): string {
  return formatDuration(seconds, settings.durationFormat);
}

/** A whole count with the browser's digit grouping, such as "1,234". */
export function formatCount(count: number): string {
  return countFormat.format(count);
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(NUMBER_LOCALE, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return t('common.moneyFallback', { amount: (cents / 100).toFixed(2), currency });
  }
}
