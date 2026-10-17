import { useEffect, useState } from 'react';
import { useMe, usePreferences } from '../api/hooks.ts';
import type { DurationFormat } from '../api/types.ts';
import { formatDuration } from '@tokkl/common/duration';
import { snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import { addDays, dateKey, parseDateKey, zonedParts } from '@tokkl/common/time';

export interface Settings {
  timeZone: string;
  dateFormat: string;
  twelveHour: boolean;
  durationFormat: DurationFormat;
  beginningOfWeek: number;
  collapseSimilar: boolean;
  shortcuts: boolean;
  /** Minutes every saved entry's duration is a multiple of, from the instance settings. */
  timeResolution: number;
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
    timeResolution: me?.time_resolution_minutes ?? 1,
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

/**
 * Seconds the server will store for a stopped entry from `start` to `stop`: both cut to whole
 * seconds, then snapped to the time resolution. Use it to preview an entry before saving; a saved
 * entry already holds its snapped times, and a running timer shows real seconds (`entrySeconds`).
 */
export function snappedSeconds(start: Date, stop: Date, settings: Pick<Settings, 'timeZone' | 'timeResolution'>): number {
  const from = wholeSecond(start);
  const to = wholeSecond(stop);
  if (to <= from) return 0;
  const span = snapSpan(from, to, settings.timeResolution, settings.timeZone);
  return (span.stop.getTime() - span.start.getTime()) / 1000;
}

/**
 * The grid point of the time resolution nearest `at`, cut to whole seconds first: where the server
 * moves a start it saves. Use it to pick one instant that stays put when either side is saved.
 */
export function snappedInstant(at: Date, settings: Pick<Settings, 'timeZone' | 'timeResolution'>): Date {
  const point = wholeSecond(at);
  return snapSpan(point, point, settings.timeResolution, settings.timeZone).start;
}

export interface SplitHalves {
  first: SnappedSpan;
  second: SnappedSpan;
}

/**
 * The two halves of the stopped entry from `start` to `stop` cut at `at`, as the server will store
 * them. Both come from the snapped whole, so an entry saved under another resolution splits into
 * halves that add up to what it would store now. The result is `'outside'` when `at` is not strictly
 * inside the snapped whole, and `'clock-change'` when the stored halves would not meet at one
 * instant and add up to the whole.
 *
 * A grid point inside the whole normally works. Across a clock change that is not a multiple of
 * the resolution, such as Lord Howe Island's half hour at a resolution of 60, the grid points on
 * either side of the change are not a whole number of steps apart. Each half's duration then rounds
 * up, and the halves would overlap.
 */
export function snappedSplit(
  start: Date, stop: Date, at: Date, settings: Pick<Settings, 'timeZone' | 'timeResolution'>,
): SplitHalves | 'outside' | 'clock-change' {
  const snap = (from: Date, to: Date) => snapSpan(wholeSecond(from), wholeSecond(to), settings.timeResolution, settings.timeZone);
  const whole = snap(start, stop);
  const cut = wholeSecond(at);
  if (cut <= whole.start || cut >= whole.stop) return 'outside';
  const first = snap(whole.start, cut);
  const second = snap(cut, whole.stop);
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  const meets = same(first.start, whole.start) && same(first.stop, second.start) && same(second.stop, whole.stop);
  return meets ? { first, second } : 'clock-change';
}

function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
