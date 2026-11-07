import type { TimeEntry } from '../api/types.ts';
import { localDay } from './entryTime.ts';

/** How the timer page's entry list groups stopped entries into days and rows. */

export type StoppedEntry = TimeEntry & { stop: string };

export function isStopped(entry: TimeEntry): entry is StoppedEntry {
  return entry.stop !== null;
}

/** Seconds from start to stop of a stopped entry. */
export function stoppedSeconds(entry: StoppedEntry): number {
  return Math.max(0, Math.floor((Date.parse(entry.stop) - Date.parse(entry.start)) / 1000));
}

export function totalSeconds(entries: readonly StoppedEntry[]): number {
  return entries.reduce((sum, entry) => sum + stoppedSeconds(entry), 0);
}

export interface EntryDay {
  day: string;
  entries: StoppedEntry[];
}

/** Stopped entries by the account-local day they started, newest day first. Running entries are left out. */
export function entriesByDay(entries: readonly TimeEntry[], timeZone: string): EntryDay[] {
  const byDay = new Map<string, StoppedEntry[]>();
  for (const entry of entries) {
    if (!isStopped(entry)) continue;
    const key = localDay(entry.start, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  return [...byDay].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => ({ day, entries: list }));
}

export interface EntryRowGroup {
  key: string;
  entries: StoppedEntry[];
}

function similarityKey(entry: TimeEntry): string {
  return [entry.description, entry.project_id, entry.task_id, entry.billable, [...entry.tags].sort().join(',')].join(
    '\u0000',
  );
}

/**
 * The rows of one day. With `collapse`, entries with the same description, project, task, billable
 * flag and tags share a row. Rows are keyed by their oldest member's id, not by the fields they are
 * grouped on, so an edit from another device does not remount the row someone is typing in, and a
 * group keeps its key when entries join it (a split adds a newer id).
 */
export function rowsForDay(entries: readonly StoppedEntry[], collapse: boolean): EntryRowGroup[] {
  if (!collapse) return entries.map(entry => ({ key: String(entry.id), entries: [entry] }));
  const groups = new Map<string, StoppedEntry[]>();
  for (const entry of entries) {
    const similar = similarityKey(entry);
    groups.set(similar, [...(groups.get(similar) ?? []), entry]);
  }
  return [...groups.values()].map(members => ({ key: String(Math.min(...members.map(e => e.id))), entries: members }));
}

/** The clock range spanned by the timed entries, or '' when there are none. */
export function rangeLabel(entries: readonly StoppedEntry[], format: (iso: string) => string): string {
  const timed = entries.filter(e => !e.all_day);
  if (timed.length === 0) return '';
  const starts = timed.map(e => e.start).sort();
  const stops = timed.map(e => e.stop).sort();
  return `${format(starts[0]!)} – ${format(stops[stops.length - 1]!)}`;
}

/**
 * The ids of `selected` that are still in `entries`, in the order they were selected, so a
 * selection never counts or edits entries that went away.
 */
export function presentSelection(selected: ReadonlySet<number>, entries: readonly TimeEntry[]): Set<number> {
  const shown = new Set(entries.map(entry => entry.id));
  return new Set([...selected].filter(id => shown.has(id)));
}
