import { useEffect, useState } from 'react';
import { useMe, usePreferences } from '../api/hooks.ts';
import type { DurationFormat } from '../api/types.ts';
import { formatDuration } from '@tokkl/common/duration';
import { addDays, dateKey, parseDateKey, zonedParts } from '@tokkl/common/time';

export interface Settings {
  timeZone: string;
  dateFormat: string;
  twelveHour: boolean;
  durationFormat: DurationFormat;
  beginningOfWeek: number;
  collapseSimilar: boolean;
  shortcuts: boolean;
}

export function useSettings(): Settings {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  return {
    timeZone: me?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    dateFormat: prefs?.date_format ?? 'YYYY-MM-DD',
    twelveHour: /a/i.test(prefs?.timeofday_format ?? 'H:mm'),
    durationFormat: prefs?.duration_format ?? 'improved',
    beginningOfWeek: me?.beginning_of_week ?? 1,
    collapseSimilar: prefs?.collapseTimeEntries ?? true,
    shortcuts: prefs?.keyboard_shortcuts_enabled ?? true,
  };
}

/** Re-renders every `intervalMs` and returns the current time. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

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

/** Elapsed seconds for an entry; running entries count up to `now`. */
export function entrySeconds(entry: { start: string; stop: string | null }, now: Date): number {
  const end = entry.stop ? Date.parse(entry.stop) : now.getTime();
  return Math.max(0, Math.floor((end - Date.parse(entry.start)) / 1000));
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
