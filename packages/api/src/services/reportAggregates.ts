/** Aggregates keep sums and first-seen labels, never the entries. */
import { addDays, daysBetween, startOfWeek } from '@tokkl/common/time';
import type { Dimension } from '../domain/reportCommands.ts';
import type { ReportEntry } from './reports.ts';

export interface Aggregate<T> {
  add(entry: ReportEntry): void;
  result(): T;
}

export interface Totals {
  seconds: number;
  billableSeconds: number;
  entryCount: number;
  amounts: Array<{ currency: string; cents: number }>;
}

export function totals(): Aggregate<Totals> {
  const amounts = new Map<string, number>();
  let seconds = 0;
  let billableSeconds = 0;
  let entryCount = 0;
  return {
    add(entry) {
      entryCount++;
      seconds += entry.seconds;
      if (entry.billable) billableSeconds += entry.seconds;
      if (entry.amountCents !== null)
        amounts.set(entry.currency, (amounts.get(entry.currency) ?? 0) + entry.amountCents);
    },
    result: () => ({
      seconds,
      billableSeconds,
      entryCount,
      amounts: [...amounts].map(([currency, cents]) => ({ currency, cents })),
    }),
  };
}

export type Resolution = 'day' | 'week' | 'month';

export function resolutionFor(startDate: string, endDate: string): Resolution {
  const days = daysBetween(startDate, endDate) + 1;
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

export function timeSeries(
  startDate: string,
  endDate: string,
  resolution: Resolution,
  beginningOfWeek: number,
): Aggregate<Array<{ start: string; seconds: number; billableSeconds: number }>> {
  const bucketOf = (key: string): string => {
    if (resolution === 'day') return key;
    if (resolution === 'week') return startOfWeek(key, beginningOfWeek);
    return `${key.slice(0, 7)}-01`;
  };
  const buckets = new Map<string, { seconds: number; billableSeconds: number }>();
  for (let key = bucketOf(startDate); key <= endDate;) {
    buckets.set(key, { seconds: 0, billableSeconds: 0 });
    if (resolution === 'day') key = addDays(key, 1);
    else if (resolution === 'week') key = addDays(key, 7);
    else {
      const [y, m] = key.split('-').map(Number) as [number, number];
      key = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  return {
    add(entry) {
      const bucket = buckets.get(bucketOf(entry.date));
      if (!bucket) return;
      bucket.seconds += entry.seconds;
      if (entry.billable) bucket.billableSeconds += entry.seconds;
    },
    result: () => [...buckets].map(([start, value]) => ({ start, ...value })),
  };
}

export type WeeklyRows = 'projects' | 'clients';

interface WeeklyGrid {
  /** One column per day for ranges up to a week, one per week beyond. */
  mode: 'days' | 'weeks';
  /** Clipped to the range. */
  columns: Array<{ start: string; end: string }>;
  rows: Array<{ id: number | null; title: string; color: string | null; cells: number[]; total: number }>;
  columnTotals: number[];
  total: number;
}

/** Week columns start on `beginningOfWeek`; the first and last are clipped to the range. */
export function weeklyGrid(
  startDate: string,
  endDate: string,
  by: WeeklyRows,
  beginningOfWeek: number,
): Aggregate<WeeklyGrid> {
  const mode = daysBetween(startDate, endDate) + 1 <= 7 ? 'days' : 'weeks';
  const columnOf = (key: string): string => (mode === 'days' ? key : startOfWeek(key, beginningOfWeek));
  const columns: WeeklyGrid['columns'] = [];
  const index = new Map<string, number>();
  for (let key = columnOf(startDate); key <= endDate; key = addDays(key, mode === 'days' ? 1 : 7)) {
    const last = mode === 'days' ? key : addDays(key, 6);
    index.set(key, columns.length);
    columns.push({ start: key < startDate ? startDate : key, end: last > endDate ? endDate : last });
  }
  const rows = new Map<string, WeeklyGrid['rows'][number]>();
  const columnTotals = columns.map(() => 0);
  let total = 0;
  return {
    add(entry) {
      const column = index.get(columnOf(entry.date));
      if (column === undefined) return;
      const id = by === 'projects' ? entry.projectId : entry.clientId;
      let row = rows.get(String(id));
      if (!row) {
        row =
          by === 'projects'
            ? { id, title: entry.projectName ?? '', color: entry.projectColor, cells: columns.map(() => 0), total: 0 }
            : { id, title: entry.clientName ?? '', color: null, cells: columns.map(() => 0), total: 0 };
        rows.set(String(id), row);
      }
      row.cells[column]! += entry.seconds;
      row.total += entry.seconds;
      columnTotals[column]! += entry.seconds;
      total += entry.seconds;
    },
    result() {
      // The "without project/client" row goes last; the rest by total, then title.
      const sorted = [...rows.values()].sort(
        (a, b) => Number(a.id === null) - Number(b.id === null) || b.total - a.total || a.title.localeCompare(b.title),
      );
      return { mode, columns, rows: sorted, columnTotals, total };
    },
  };
}

export interface GroupKey {
  id: number | null;
  title: string;
  color: string | null;
}

/** Tags can yield several keys; an untagged entry yields one null key. */
function keysFor(entry: ReportEntry, dimension: Dimension): GroupKey[] {
  switch (dimension) {
    case 'project':
      return [{ id: entry.projectId, title: entry.projectName ?? '', color: entry.projectColor }];
    case 'client':
      return [{ id: entry.clientId, title: entry.clientName ?? '', color: null }];
    case 'task':
      return [{ id: entry.taskId, title: entry.taskName ?? '', color: null }];
    case 'tag':
      return entry.tags.length
        ? entry.tags.map(tag => ({ id: tag.id, title: tag.name, color: null }))
        : [{ id: null, title: '', color: null }];
    case 'description':
      return [{ id: null, title: entry.description, color: null }];
    case 'none':
      return [{ id: null, title: '', color: null }];
  }
}

export interface Group extends GroupKey {
  seconds: number;
  billableSeconds: number;
  amountCents: number;
  entryIds: number[];
  subGroups: Group[];
}

function groupKeyString(key: GroupKey, dimension: Dimension): string {
  return dimension === 'description' ? `d:${key.title}` : `i:${key.id ?? 'none'}`;
}

/** Largest first. A group keeps the key of the first entry that reached it; ties keep first-seen order. */
export function grouping(dimension: Dimension, subDimension: Dimension = 'none'): Aggregate<Group[]> {
  const groups = new Map<
    string,
    { key: GroupKey; totals: Aggregate<Totals>; entryIds: number[]; subGroups?: Aggregate<Group[]> }
  >();
  return {
    add(entry) {
      for (const key of keysFor(entry, dimension)) {
        const id = groupKeyString(key, dimension);
        let group = groups.get(id);
        if (!group) {
          group = { key, totals: totals(), entryIds: [] };
          if (subDimension !== 'none') group.subGroups = grouping(subDimension);
          groups.set(id, group);
        }
        group.totals.add(entry);
        group.entryIds.push(entry.id);
        group.subGroups?.add(entry);
      }
    },
    result: () =>
      [...groups.values()]
        .map(({ key, totals: sums, entryIds, subGroups }) => {
          const total = sums.result();
          return {
            ...key,
            seconds: total.seconds,
            billableSeconds: total.billableSeconds,
            amountCents: total.amounts.reduce((sum, amount) => sum + amount.cents, 0),
            entryIds,
            subGroups: subGroups ? subGroups.result() : [],
          };
        })
        .sort((a, b) => b.seconds - a.seconds),
  };
}
