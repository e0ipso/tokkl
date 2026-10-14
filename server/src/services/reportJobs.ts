import type { Db } from '../db/index.ts';
import { toCsv } from '../lib/csv.ts';
import { badRequest } from '../lib/errors.ts';
import { togglTime } from '../lib/values.ts';
import { formatDuration, type DurationFormat } from '../../../shared/duration.ts';
import { addDays, daysBetween, startOfWeek } from '../../../shared/time.ts';
import type { UserRow } from '../models/users.ts';
import type { WorkspaceRow } from '../models/workspaces.ts';
import { toTogglCsv } from './export.ts';
import {
  collectEntries, groupEntries, resolutionFor, timeSeries, totalsOf, weeklyGrid,
  type Dimension, type Group, type ReportEntry, type ReportFilter, type Resolution,
} from './reports.ts';

/**
 * The part of each report request that reads the entries and builds the response body. The routes
 * validate the request first and pass a job here, so a job only fails on a bug. Jobs read the
 * database and nothing else, which lets them run in the report worker (see reportRunner.ts).
 */
export type ReportJob =
  | { kind: 'v3-search'; filter: ReportFilter; orderBy: unknown; orderDir: unknown; pageSize: number; firstRow: number }
  | { kind: 'v3-totals'; filter: ReportFilter; granularity: Resolution; withGraph: boolean }
  | { kind: 'v3-csv'; filter: ReportFilter; orderBy: unknown; orderDir: unknown; durationFormat: unknown }
  | { kind: 'v3-summary'; filter: ReportFilter; grouping: Dimension; sub: Dimension; includeIds: boolean }
  | { kind: 'v3-summary-csv'; filter: ReportFilter; grouping: Dimension; sub: Dimension; durationFormat: unknown }
  | { kind: 'v3-weekly'; filter: ReportFilter; weekStart: string }
  | { kind: 'app-weekly'; filter: ReportFilter; rows: 'projects' | 'clients' }
  | { kind: 'app-report'; filter: ReportFilter; grouping: Dimension; sub: Dimension }
  | { kind: 'app-entries'; filter: ReportFilter; sort: 'date' | 'duration' | 'description'; dir: 'asc' | 'desc'; pageSize: number; page: number }
  | { kind: 'app-detailed-csv'; filter: ReportFilter; sort: 'date' | 'duration' | 'description'; dir: 'asc' | 'desc'; durationFormat: unknown }
  | { kind: 'app-summary-csv'; filter: ReportFilter; grouping: Dimension; sub: Dimension; durationFormat: unknown };

/** A finished response: a JSON or CSV body plus any extra headers. */
export interface JobResult {
  type: 'json' | 'csv';
  body: string;
  filename?: string;
  headers: Record<string, string>;
}

function durationFormatOf(value: unknown): DurationFormat {
  return value === 'classic' || value === 'decimal' ? value : 'improved';
}

const ORDER_BY = ['date', 'user', 'duration', 'description', 'last_update'];

/** Throws the Toggl error for an unknown order_by, before any entry is read. */
export function checkOrderBy(orderBy: unknown): void {
  if (!(ORDER_BY as unknown[]).includes(orderBy ?? 'date')) {
    throw badRequest("Invalid 'order_by' value, allowed values are: 'date, user, duration, description, last_update'");
  }
}

function sortDetailed(entries: ReportEntry[], orderBy: unknown, orderDir: unknown): ReportEntry[] {
  checkOrderBy(orderBy);
  const dir = String(orderDir ?? 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
  const sorted = [...entries];
  switch (orderBy ?? 'date') {
    case 'date':
    case 'user':
      sorted.sort((a, b) => dir * (a.start.localeCompare(b.start) || a.id - b.id));
      break;
    case 'duration':
      sorted.sort((a, b) => dir * (a.seconds - b.seconds || a.id - b.id));
      break;
    case 'description':
      sorted.sort((a, b) => dir * (a.description.localeCompare(b.description) || a.id - b.id));
      break;
    case 'last_update':
      sorted.sort((a, b) => dir * (a.at.localeCompare(b.at) || a.id - b.id));
      break;
  }
  return sorted;
}

function detailedRow(entry: ReportEntry, rowNumber: number, user: { id: number; fullname: string; email: string }) {
  return {
    user_id: user.id,
    username: user.fullname,
    email: user.email,
    project_id: entry.projectId,
    project_name: entry.projectName,
    project_color: entry.projectColor,
    project_hex: entry.projectColor,
    client_name: entry.clientName,
    task_id: entry.taskId,
    task_name: entry.taskName,
    description: entry.description,
    billable: entry.billable,
    tag_ids: entry.tags.map((tag) => tag.id),
    tag_names: entry.tags.map((tag) => tag.name),
    hourly_rate_in_cents: entry.hourlyRateCents,
    billable_amount_in_cents: entry.amountCents,
    currency: entry.currency,
    row_number: rowNumber,
    time_entries: [{
      id: entry.id,
      seconds: entry.seconds,
      start: togglTime(entry.start),
      stop: togglTime(entry.stop),
      at: togglTime(entry.at),
    }],
  };
}

function summaryGroup(group: Group, groupingDimension: Dimension, includeIds: boolean) {
  return {
    id: groupingDimension === 'description' ? null : group.id,
    ...(groupingDimension === 'project' ? { project_color: group.color, project_hex_color: group.color } : {}),
    sub_groups: group.subGroups.map((sub) => ({
      id: sub.id,
      title: sub.title,
      seconds: sub.seconds,
      ...(includeIds ? { ids: sub.entryIds } : {}),
    })),
    ...(group.subGroups.length === 0 ? { seconds: group.seconds } : {}),
  };
}

/** Toggl's detailed CSV layout. */
function detailedCsv(entries: ReportEntry[], user: UserRow, durationFormat: unknown): string {
  return toTogglCsv(entries.map((entry) => ({
    ...entry, tags: entry.tags.map((tag) => tag.name),
  })), user, durationFormatOf(durationFormat));
}

/** One row per group, or per sub-group when the groups have them. */
function summaryCsv(groups: Group[], durationFormat: unknown): string {
  const format = durationFormatOf(durationFormat);
  const rows: Array<Array<string | number | null>> = [['Group', 'Sub group', 'Duration']];
  for (const group of groups) {
    if (group.subGroups.length === 0) rows.push([group.title || '(none)', '', formatDuration(group.seconds, format)]);
    for (const subGroup of group.subGroups) {
      rows.push([group.title || '(none)', subGroup.title || '(none)', formatDuration(subGroup.seconds, format)]);
    }
  }
  return toCsv(rows);
}

function appEntry(entry: ReportEntry) {
  return {
    id: entry.id, description: entry.description, start: entry.start, stop: entry.stop, seconds: entry.seconds,
    billable: entry.billable, project_id: entry.projectId, project_name: entry.projectName, project_color: entry.projectColor,
    client_name: entry.clientName, task_name: entry.taskName, tags: entry.tags.map((tag) => tag.name),
    amount_cents: entry.amountCents, currency: entry.currency,
  };
}

function rangeHeaders(startDate: string, endDate: string): Record<string, string> {
  return { 'X-Range-Start': startDate, 'X-Range-End': endDate };
}

const json = (value: unknown, headers: Record<string, string> = {}): JobResult => ({ type: 'json', body: JSON.stringify(value), headers });
const csv = (body: string, filename: string, headers: Record<string, string> = {}): JobResult => ({ type: 'csv', body, filename, headers });

function v3Weekly(entries: ReportEntry[], user: UserRow, weekStart: string) {
  const rows = new Map<string, ReturnType<typeof emptyWeeklyRow>>();
  function emptyWeeklyRow(entry: ReportEntry) {
    return {
      user_id: user.id, user_name: user.fullname, project_id: entry.projectId, project_name: entry.projectName,
      project_color: entry.projectColor, project_hex_color: entry.projectColor, client_name: entry.clientName,
      planned_task_id: null, seconds: Array<number>(7).fill(0), billable_seconds: Array<number>(7).fill(0),
      billable_amounts_in_cents: Array<number>(7).fill(0), hourly_rate_in_cents: entry.hourlyRateCents, currency: entry.currency,
    };
  }
  for (const entry of entries) {
    const key = String(entry.projectId ?? 'none');
    let row = rows.get(key);
    if (!row) rows.set(key, (row = emptyWeeklyRow(entry)));
    const day = daysBetween(weekStart, entry.date);
    if (day < 0 || day > 6) continue;
    row.seconds[day]! += entry.seconds;
    if (entry.billable) row.billable_seconds[day]! += entry.seconds;
    row.billable_amounts_in_cents[day]! += entry.amountCents ?? 0;
  }
  return [...rows.values()];
}

export function runJob(db: Db, user: UserRow, ws: WorkspaceRow, job: ReportJob): JobResult {
  const { filter } = job;
  const entries = () => collectEntries(db, user, ws, filter);
  switch (job.kind) {
    case 'v3-search': {
      const sorted = sortDetailed(entries(), job.orderBy, job.orderDir);
      const { firstRow, pageSize } = job;
      const headers = rangeHeaders(filter.startDate, filter.endDate);
      if (firstRow - 1 + pageSize < sorted.length) {
        headers['X-Next-ID'] = String(sorted[firstRow - 1 + pageSize]!.id);
        headers['X-Next-Row-Number'] = String(firstRow + pageSize);
      }
      const page = sorted.slice(firstRow - 1, firstRow - 1 + pageSize);
      return json(page.map((entry, i) => detailedRow(entry, firstRow + i, user)), headers);
    }
    case 'v3-totals': {
      const list = entries();
      const totals = totalsOf(list);
      const series = timeSeries(list, filter.startDate, filter.endDate, job.granularity, user.beginning_of_week);
      return json({
        seconds: totals.seconds,
        tracked_days: new Set(list.map((e) => e.date)).size,
        billable_amount_in_cents: totals.amounts.reduce((sum, a) => sum + a.cents, 0),
        labour_cost_in_cents: 0,
        resolution: job.granularity,
        rates: [],
        graph: job.withGraph ? series.map((point) => ({ seconds: point.seconds, billable_amount_in_cents: 0, labour_cost_in_cents: 0, by_rate: {} })) : [],
      }, rangeHeaders(filter.startDate, filter.endDate));
    }
    case 'v3-csv':
      return csv(detailedCsv(sortDetailed(entries(), job.orderBy, job.orderDir), user, job.durationFormat), 'Toggl_time_entries.csv');
    case 'v3-summary': {
      const groups = groupEntries(entries(), job.grouping, job.sub);
      return json({ groups: groups.map((group) => summaryGroup(group, job.grouping, job.includeIds)) });
    }
    case 'v3-summary-csv':
      return csv(summaryCsv(groupEntries(entries(), job.grouping, job.sub), job.durationFormat), 'Toggl_summary.csv');
    case 'v3-weekly':
      return json(v3Weekly(entries(), user, job.weekStart), rangeHeaders(job.weekStart, filter.endDate));
    case 'app-weekly': {
      const grid = weeklyGrid(entries(), filter.startDate, filter.endDate, job.rows, user.beginning_of_week);
      return json({
        start_date: filter.startDate,
        end_date: filter.endDate,
        mode: grid.mode,
        columns: grid.columns,
        rows: grid.rows,
        column_totals: grid.columnTotals,
        total: grid.total,
      });
    }
    case 'app-report': {
      const list = entries();
      const resolution = resolutionFor(filter.startDate, filter.endDate);
      const totals = totalsOf(list);
      return json({
        start_date: filter.startDate,
        end_date: filter.endDate,
        resolution,
        week_start: startOfWeek(filter.startDate, user.beginning_of_week),
        totals: {
          seconds: totals.seconds,
          billable_seconds: totals.billableSeconds,
          entry_count: totals.entryCount,
          amounts: totals.amounts,
        },
        series: timeSeries(list, filter.startDate, filter.endDate, resolution, user.beginning_of_week)
          .map((point) => ({ start: point.start, seconds: point.seconds, billable_seconds: point.billableSeconds })),
        groups: groupEntries(list, job.grouping, job.grouping === job.sub ? 'none' : job.sub).map(function toJson(group): unknown {
          return {
            id: group.id, title: group.title, color: group.color, seconds: group.seconds,
            billable_seconds: group.billableSeconds, amount_cents: group.amountCents,
            sub_groups: group.subGroups.map(toJson),
          };
        }),
      });
    }
    case 'app-entries': {
      const sorted = sortDetailed(entries(), job.sort, job.dir);
      const pages = Math.max(1, Math.ceil(sorted.length / job.pageSize));
      // A bookmarked page past the end shows the last page; the response says which page it is.
      const page = Math.min(job.page, pages);
      return json({
        total: sorted.length,
        page,
        page_size: job.pageSize,
        pages,
        has_amounts: sorted.some((entry) => entry.amountCents !== null),
        entries: sorted.slice((page - 1) * job.pageSize, page * job.pageSize).map(appEntry),
      });
    }
    case 'app-detailed-csv':
      return csv(detailedCsv(sortDetailed(entries(), job.sort, job.dir), user, job.durationFormat), 'timetrack_detailed.csv');
    case 'app-summary-csv': {
      const groups = groupEntries(entries(), job.grouping, job.grouping === job.sub ? 'none' : job.sub);
      return csv(summaryCsv(groups, job.durationFormat), 'timetrack_summary.csv');
    }
  }
}

/** The v3 weekly report covers at most the seven days from its start date. */
export function v3WeeklyFilter(filter: ReportFilter): { filter: ReportFilter; weekStart: string } {
  const weekStart = filter.startDate;
  const days = Math.min(daysBetween(weekStart, filter.endDate) + 1, 7);
  return { weekStart, filter: { ...filter, endDate: addDays(weekStart, days - 1) } };
}
