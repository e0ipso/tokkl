import type { TimeEntry } from '@tokkl/types';
import { localDay } from './entryTime.ts';
import { entrySeconds } from './snapping.ts';
import { t } from '../i18n/messages.ts';

export type StoppedEntry = TimeEntry & { stop: string };

export function isStopped(entry: TimeEntry): entry is StoppedEntry {
  return entry.stop !== null;
}

export function stoppedSeconds(entry: StoppedEntry): number {
  return Math.max(0, Math.floor((Date.parse(entry.stop) - Date.parse(entry.start)) / 1000));
}

export function totalSeconds(entries: readonly StoppedEntry[]): number {
  return entries.reduce((sum, entry) => sum + stoppedSeconds(entry), 0);
}

interface EntryDay {
  day: string;
  entries: StoppedEntry[];
}

/** Newest day first; running entries are left out. */
export function entriesByDay(entries: readonly TimeEntry[], timeZone: string): EntryDay[] {
  const byDay = new Map<string, StoppedEntry[]>();
  for (const entry of entries) {
    if (!isStopped(entry)) continue;
    const key = localDay(entry.start, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  return [...byDay].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => ({ day, entries: list }));
}

export type NonEmpty<T> = [T, ...T[]];

export interface EntryRowGroup {
  key: string;
  entries: NonEmpty<StoppedEntry>;
}

function similarityKey(entry: TimeEntry): string {
  return [entry.description, entry.project_id, entry.task_id, entry.billable, [...entry.tags].sort().join(',')].join(
    '\u0000',
  );
}

/** Rows are keyed by their oldest member's id, so another device's edit does not remount a row being typed in. */
export function rowsForDay(entries: readonly StoppedEntry[], collapse: boolean): EntryRowGroup[] {
  if (!collapse) return entries.map(entry => ({ key: String(entry.id), entries: [entry] }));
  const groups = new Map<string, NonEmpty<StoppedEntry>>();
  for (const entry of entries) {
    const similar = similarityKey(entry);
    const group = groups.get(similar);
    if (group) group.push(entry);
    else groups.set(similar, [entry]);
  }
  return [...groups.values()].map(members => ({ key: String(Math.min(...members.map(e => e.id))), entries: members }));
}

/** '' when there are none. */
export function rangeLabel(entries: readonly StoppedEntry[], format: (iso: string) => string): string {
  const timed = entries.filter(e => !e.all_day);
  if (timed.length === 0) return '';
  const starts = timed.map(e => e.start).sort();
  const stops = timed.map(e => e.stop).sort();
  return t('dates.timeRange', { start: format(starts[0]!), end: format(stops[stops.length - 1]!) });
}

/** In selection order, so a selection never counts or edits entries that went away. */
export function presentSelection(selected: ReadonlySet<number>, entries: readonly TimeEntry[]): Set<number> {
  const shown = new Set(entries.map(entry => entry.id));
  return new Set([...selected].filter(id => shown.has(id)));
}

/** Running entries count up to `now`. */
export function periodTotals(
  entries: readonly TimeEntry[],
  now: Date,
  { todayKey, weekStart, timeZone }: { todayKey: string; weekStart: string; timeZone: string },
): { todaySeconds: number; weekSeconds: number } {
  let todaySeconds = 0;
  let weekSeconds = 0;
  for (const entry of entries) {
    const day = localDay(entry.start, timeZone);
    const seconds = entrySeconds(entry, now);
    if (day === todayKey) todaySeconds += seconds;
    if (day >= weekStart && day <= todayKey) weekSeconds += seconds;
  }
  return { todaySeconds, weekSeconds };
}
