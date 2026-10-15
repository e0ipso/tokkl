import type { Db } from '../db/index.ts';
import { toCsv } from '../lib/csv.ts';
import { badRequest } from '../lib/errors.ts';
import { formatDuration } from '@tokkl/common/duration';
import type { DurationFormat } from '@tokkl/types';
import { addDays, dateKey, parseDateKey, startOfDay, zonedParts, pad2 } from '@tokkl/common/time';
import { listClients, serializeClient } from '../models/clients.ts';
import { listProjects, serializeProject } from '../models/projects.ts';
import { listTags, serializeTag } from '../models/tags.ts';
import { listTasks, serializeTask } from '../models/tasks.ts';
import { listTimeEntries, serializeTimeEntry, type TimeEntryWithMeta } from '../models/timeEntries.ts';
import { getPreferences, serializeUser, type UserRow } from '../models/users.ts';
import { listWorkspaces, serializeWorkspace } from '../models/workspaces.ts';

export const EXPORT_FORMAT = 'tokkl-export';
/** Format name written before the rename to Tokkl. Restore still accepts it. */
export const LEGACY_EXPORT_FORMAT = 'timetrack-export';
export const EXPORT_FORMAT_VERSION = 1;

/** Everything the account owns, in Toggl v9 shapes, so other tools can read it. */
export function buildJsonExport(db: Db, user: UserRow) {
  const workspaces = listWorkspaces(db);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    user: serializeUser(user, { includeToken: false }),
    preferences: getPreferences(user),
    workspaces: workspaces.map(serializeWorkspace),
    clients: workspaces.flatMap((ws) => listClients(db, ws.id).map(serializeClient)),
    projects: workspaces.flatMap((ws) => listProjects(db, ws.id).map((p) => serializeProject(p, ws.default_currency))),
    tasks: workspaces.flatMap((ws) => listTasks(db, ws.id).map(serializeTask)),
    tags: workspaces.flatMap((ws) => listTags(db, ws.id).map(serializeTag)),
    time_entries: listTimeEntries(db, user.id, {}).map((te) => serializeTimeEntry(te, { meta: true, user })),
  };
}

/** Column layout of Toggl Track's detailed CSV export, so a file can go back and forth between the two. */
export const CSV_COLUMNS = [
  'User', 'Email', 'Client', 'Project', 'Task', 'Description', 'Billable',
  'Start date', 'Start time', 'End date', 'End time', 'Duration', 'Tags',
] as const;

function localDateTime(iso: string, timeZone: string): [string, string] {
  const p = zonedParts(new Date(iso), timeZone);
  return [dateKey(new Date(iso), timeZone), `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`];
}

export interface CsvItem {
  clientName: string | null;
  projectName: string | null;
  taskName: string | null;
  description: string;
  billable: boolean;
  start: string;
  stop: string;
  seconds: number;
  tags: string[];
}

export function toTogglCsv(items: CsvItem[], user: UserRow, durationFormat: DurationFormat = 'improved'): string {
  const rows: Array<Array<string | number | null>> = [[...CSV_COLUMNS]];
  for (const item of items) {
    const [startDate, startTime] = localDateTime(item.start, user.timezone);
    const [endDate, endTime] = localDateTime(item.stop, user.timezone);
    rows.push([
      user.fullname, user.email, item.clientName, item.projectName, item.taskName, item.description,
      item.billable ? 'Yes' : 'No', startDate, startTime, endDate, endTime,
      formatDuration(item.seconds, durationFormat), item.tags.join(', '),
    ]);
  }
  return toCsv(rows);
}

function csvItem(entry: TimeEntryWithMeta): CsvItem | null {
  if (!entry.stop) return null;
  return {
    clientName: entry.client_name,
    projectName: entry.project_name,
    taskName: entry.task_name,
    description: entry.description,
    billable: entry.billable === 1,
    start: entry.start,
    stop: entry.stop,
    seconds: Math.floor((Date.parse(entry.stop) - Date.parse(entry.start)) / 1000),
    tags: (JSON.parse(entry.tags_json) as Array<{ name: string }>).map((tag) => tag.name),
  };
}

export function buildCsvExport(db: Db, user: UserRow, range: { from?: string; to?: string }): string {
  const filter: { from?: Date; to?: Date } = {};
  if (range.from) {
    if (!parseDateKey(range.from)) throw badRequest('Invalid start_date: expected YYYY-MM-DD');
    filter.from = startOfDay(range.from, user.timezone);
  }
  if (range.to) {
    if (!parseDateKey(range.to)) throw badRequest('Invalid end_date: expected YYYY-MM-DD');
    filter.to = startOfDay(addDays(range.to, 1), user.timezone);
  }
  const entries = listTimeEntries(db, user.id, filter).reverse();
  return toTogglCsv(entries.map(csvItem).filter((item): item is CsvItem => item !== null), user);
}
