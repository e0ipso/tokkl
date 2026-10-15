import { addDays, daysBetween, parseDateKey, startOfWeek } from '@tokkl/common/time';
import { shortDate } from '../../lib/settings.ts';

export const PRESETS = [
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30', 'this_year', 'last_year',
  'all_time',
] as const;

/** The server accepts report ranges of up to ten years. */
export const MAX_RANGE_DAYS = 3660;

export type Preset = (typeof PRESETS)[number];

export const PRESET_LABELS: Record<Preset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_30: 'Last 30 days',
  this_year: 'This year',
  last_year: 'Last year',
  all_time: 'All time',
};

/** An inclusive range of calendar days, both "YYYY-MM-DD" in the account timezone. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export function isPreset(value: string | null): value is Preset {
  return value !== null && (PRESETS as readonly string[]).includes(value);
}

export function isDateKey(value: string | null): value is string {
  return value !== null && parseDateKey(value) !== null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** First day of the month `months` away from the month containing `key`. */
export function addMonths(key: string, months: number): string {
  const parsed = parseDateKey(key)!;
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

export function endOfMonth(key: string): string {
  return addDays(addMonths(key, 1), -1);
}

/**
 * Resolves a preset to dates. `firstDay` is the date of the oldest entry and only matters for
 * "All time", which spans from there to today (at most ten years back).
 */
export function presetRange(preset: Preset, todayKey: string, beginningOfWeek: number, firstDay?: string | null): DateRange {
  const weekStart = startOfWeek(todayKey, beginningOfWeek);
  const year = todayKey.slice(0, 4);
  switch (preset) {
    case 'today':
      return { from: todayKey, to: todayKey };
    case 'yesterday': {
      const day = addDays(todayKey, -1);
      return { from: day, to: day };
    }
    case 'this_week':
      return { from: weekStart, to: addDays(weekStart, 6) };
    case 'last_week':
      return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
    case 'this_month':
      return { from: startOfMonth(todayKey), to: endOfMonth(todayKey) };
    case 'last_month': {
      const from = addMonths(todayKey, -1);
      return { from, to: endOfMonth(from) };
    }
    case 'last_30':
      return { from: addDays(todayKey, -29), to: todayKey };
    case 'this_year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'last_year':
      return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
    case 'all_time': {
      const earliest = addDays(todayKey, -(MAX_RANGE_DAYS - 1));
      const from = firstDay && firstDay <= todayKey ? (firstDay < earliest ? earliest : firstDay) : todayKey;
      return { from, to: todayKey };
    }
  }
}

/** The preset whose range equals `range` today, if any. */
export function matchingPreset(range: DateRange, todayKey: string, beginningOfWeek: number, firstDay?: string | null): Preset | null {
  return PRESETS.find((preset) => {
    const candidate = presetRange(preset, todayKey, beginningOfWeek, firstDay);
    return candidate.from === range.from && candidate.to === range.to;
  }) ?? null;
}

export function rangeDays(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

/** Number of whole calendar months the range covers, or 0 when it does not start and end on month edges. */
function wholeMonths(range: DateRange): number {
  if (range.from !== startOfMonth(range.from) || range.to !== endOfMonth(range.to)) return 0;
  const a = parseDateKey(range.from)!;
  const b = parseDateKey(range.to)!;
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

/**
 * Moves the range by its own length. Ranges made of whole months move by calendar months, so
 * "last month" steps to the month before it; everything else moves by its number of days.
 */
export function shiftRange(range: DateRange, direction: 1 | -1): DateRange {
  const months = wholeMonths(range);
  if (months > 0) {
    const from = addMonths(range.from, direction * months);
    return { from, to: endOfMonth(addMonths(from, months - 1)) };
  }
  const days = rangeDays(range) * direction;
  return { from: addDays(range.from, days), to: addDays(range.to, days) };
}

export function formatRange(range: DateRange, todayKey: string): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const showYear = !sameYear || range.from.slice(0, 4) !== todayKey.slice(0, 4);
  const label = (key: string, withYear: boolean) => `${shortDate(key)}${withYear ? ` ${key.slice(0, 4)}` : ''}`;
  if (range.from === range.to) return label(range.from, showYear);
  return `${label(range.from, !sameYear)} to ${label(range.to, showYear)}`;
}
