/** The shapes report jobs answer with: detailed rows, summary groups, CSV tables and replies. */
import { formatDuration } from '@tokkl/common/duration';
import { daysBetween } from '@tokkl/common/time';
import type { DurationFormat } from '@tokkl/types';
import type { OrderBy, SortDirection } from '../commands/reports.ts';
import { toCsv } from '../lib/csv.ts';
import { togglTime } from '../lib/values.ts';
import type { Dimension, Group } from './reportAggregates.ts';
import { toTogglCsv } from './exports.ts';
/** A finished response: a JSON or CSV body plus any extra headers. */
export interface JobResult {
  type: 'json' | 'csv';
  body: string;
  filename?: string;
  headers: Record<string, string>;
}
import type { ReportEntry, ReportUser } from './reports.ts';

export function sortDetailed(entries: ReportEntry[], orderBy: OrderBy, direction: SortDirection): ReportEntry[] {
  const dir = direction === 'ASC' ? 1 : -1;
  const sorted = [...entries];
  switch (orderBy) {
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

export function detailedRow(
  entry: ReportEntry,
  rowNumber: number,
  user: { id: number; fullName: string; email: string },
) {
  return {
    user_id: user.id,
    username: user.fullName,
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
    tag_ids: entry.tags.map(tag => tag.id),
    tag_names: entry.tags.map(tag => tag.name),
    hourly_rate_in_cents: entry.hourlyRateCents,
    billable_amount_in_cents: entry.amountCents,
    currency: entry.currency,
    row_number: rowNumber,
    time_entries: [
      {
        id: entry.id,
        seconds: entry.seconds,
        start: togglTime(entry.start),
        stop: togglTime(entry.stop),
        at: togglTime(entry.at),
        all_day: entry.allDay,
      },
    ],
  };
}

export function summaryGroup(group: Group, groupingDimension: Dimension, includeIds: boolean) {
  return {
    id: groupingDimension === 'description' ? null : group.id,
    ...(groupingDimension === 'project' ? { project_color: group.color, project_hex_color: group.color } : {}),
    sub_groups: group.subGroups.map(sub => ({
      id: sub.id,
      title: sub.title,
      seconds: sub.seconds,
      ...(includeIds ? { ids: sub.entryIds } : {}),
    })),
    ...(group.subGroups.length === 0 ? { seconds: group.seconds } : {}),
  };
}

/** Toggl's detailed CSV layout. */
export function detailedCsv(entries: ReportEntry[], user: ReportUser, durationFormat: DurationFormat): string {
  return toTogglCsv(
    entries.map(entry => ({
      ...entry,
      tags: entry.tags.map(tag => tag.name),
    })),
    user,
    durationFormat,
  );
}

/** One row per group, or per sub-group when the groups have them. */
export function summaryCsv(groups: Group[], format: DurationFormat): string {
  const rows: Array<Array<string | number | null>> = [['Group', 'Sub group', 'Duration']];
  for (const group of groups) {
    if (group.subGroups.length === 0) rows.push([group.title || '(none)', '', formatDuration(group.seconds, format)]);
    for (const subGroup of group.subGroups) {
      rows.push([group.title || '(none)', subGroup.title || '(none)', formatDuration(subGroup.seconds, format)]);
    }
  }
  return toCsv(rows);
}

export function appEntry(entry: ReportEntry) {
  return {
    id: entry.id,
    description: entry.description,
    start: entry.start,
    stop: entry.stop,
    seconds: entry.seconds,
    billable: entry.billable,
    project_id: entry.projectId,
    project_name: entry.projectName,
    project_color: entry.projectColor,
    client_name: entry.clientName,
    task_name: entry.taskName,
    tags: entry.tags.map(tag => tag.name),
    amount_cents: entry.amountCents,
    currency: entry.currency,
    all_day: entry.allDay,
  };
}

export function rangeHeaders(startDate: string, endDate: string): Record<string, string> {
  return { 'X-Range-Start': startDate, 'X-Range-End': endDate };
}

export const json = (value: unknown, headers: Record<string, string> = {}): JobResult => ({
  type: 'json',
  body: JSON.stringify(value),
  headers,
});
export const csv = (body: string, filename: string, headers: Record<string, string> = {}): JobResult => ({
  type: 'csv',
  body,
  filename,
  headers,
});

export function v3Weekly(entries: ReportEntry[], user: ReportUser, weekStart: string) {
  const rows = new Map<string, ReturnType<typeof emptyWeeklyRow>>();
  function emptyWeeklyRow(entry: ReportEntry) {
    return {
      user_id: user.id,
      user_name: user.fullName,
      project_id: entry.projectId,
      project_name: entry.projectName,
      project_color: entry.projectColor,
      project_hex_color: entry.projectColor,
      client_name: entry.clientName,
      planned_task_id: null,
      seconds: Array<number>(7).fill(0),
      billable_seconds: Array<number>(7).fill(0),
      billable_amounts_in_cents: Array<number>(7).fill(0),
      hourly_rate_in_cents: entry.hourlyRateCents,
      currency: entry.currency,
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
