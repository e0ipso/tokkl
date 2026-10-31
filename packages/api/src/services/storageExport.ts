import type { DurationFormat } from '@tokkl/types';
import { formatDuration } from '@tokkl/common/duration';
import { addDays, dateKey, parseDateKey, startOfDay, zonedParts, pad2 } from '@tokkl/common/time';
import type { AccountExportProjection, User } from '../storage/domain.ts';
import type { Repositories } from '../storage/contracts.ts';
import { serializeClient, serializeProject, serializeTag, serializeTask } from '../domain/catalogs.ts';
import { getPreferences, serializeUser, serializeWorkspace } from '../domain/accountValues.ts';
import { serializeTimeEntry } from '../domain/timeEntries.ts';
import { toCsv } from '../lib/csv.ts';
import { badRequest } from '../lib/errors.ts';

export const EXPORT_FORMAT = 'tokkl-export';
export const LEGACY_EXPORT_FORMAT = 'timetrack-export';
export const EXPORT_FORMAT_VERSION = 1;
type ExportUser = Omit<User, 'passwordHash' | 'apiToken'>;
export interface ExportRunner<R extends Pick<Repositories, 'transfers'>> {
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
/** Pure assembly, also callable inside the report worker after snapshot collection. */
export function assembleJsonExport(data: AccountExportProjection, exportedAt = new Date().toISOString()) {
  // The serializers select public fields; credentials are absent from the input projection.
  const publicUser = { ...data.user, passwordHash: '', apiToken: '' };
  const workspaces = new Map(data.workspaces.map(w => [w.id, w]));
  const memberships = new Map(data.memberships.map(m => [m.workspaceId, m.role]));
  return { format: EXPORT_FORMAT, version: EXPORT_FORMAT_VERSION, exported_at: exportedAt,
    user: serializeUser(publicUser, { includeToken: false }), preferences: getPreferences(publicUser),
    workspaces: data.workspaces.map(w => serializeWorkspace(w, memberships.get(w.id))),
    clients: data.clients.map(serializeClient),
    projects: data.projects.map(p => serializeProject(p, workspaces.get(p.workspaceId)!.defaultCurrency)),
    tasks: data.tasks.map(serializeTask), tags: data.tags.map(serializeTag),
    time_entries: data.entries.map(e => serializeTimeEntry(e, { meta: true, user: publicUser })),
  };
}
export async function collectAccountExport<R extends Pick<Repositories, 'transfers'>>(runner: ExportRunner<R>, userId: number) {
  return runner.readSnapshot(repositories => repositories.transfers.exportAccount(userId));
}
export async function buildJsonExport<R extends Pick<Repositories, 'transfers'>>(runner: ExportRunner<R>, userId: number) {
  return assembleJsonExport(await collectAccountExport(runner, userId));
}
export const CSV_COLUMNS = ['User', 'Email', 'Client', 'Project', 'Task', 'Description', 'Billable',
  'Start date', 'Start time', 'End date', 'End time', 'Duration', 'Tags'] as const;
export interface CsvItem {
  clientName: string | null; projectName: string | null; taskName: string | null; description: string;
  billable: boolean; start: string; stop: string; seconds: number; tags: string[]; allDay: boolean;
}
function localDateTime(iso: string, zone: string): [string, string] {
  const p = zonedParts(new Date(iso), zone);
  return [dateKey(new Date(iso), zone), `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`];
}
export function toTogglCsv(items: CsvItem[], user: Pick<ExportUser, 'fullName' | 'email' | 'timezone'>, durationFormat: DurationFormat = 'improved'): string {
  const rows: Array<Array<string | number | null>> = [[...CSV_COLUMNS]];
  for (const item of items) {
    const [startDate, startTime] = localDateTime(item.start, user.timezone), [endDate, endTime] = localDateTime(item.stop, user.timezone);
    rows.push([user.fullName, user.email, item.clientName, item.projectName, item.taskName, item.description, item.billable ? 'Yes' : 'No',
      startDate, item.allDay ? '' : startTime, endDate, item.allDay ? '' : endTime, formatDuration(item.seconds, durationFormat), item.tags.join(', ')]);
  }
  return toCsv(rows);
}
export function assembleCsvExport(data: AccountExportProjection, range: { from?: string; to?: string }, durationFormat: DurationFormat = 'improved'): string {
  let from: string | undefined, to: string | undefined;
  if (range.from) {
    if (!parseDateKey(range.from)) throw badRequest('Invalid start_date: expected YYYY-MM-DD');
    from = startOfDay(range.from, data.user.timezone).toISOString();
  }
  if (range.to) {
    if (!parseDateKey(range.to)) throw badRequest('Invalid end_date: expected YYYY-MM-DD');
    to = startOfDay(addDays(range.to, 1), data.user.timezone).toISOString();
  }
  const items: CsvItem[] = [];
  for (const e of [...data.entries].reverse()) if (e.stop && (!from || e.start >= from) && (!to || e.start < to)) {
    items.push({ clientName: e.client?.name ?? null, projectName: e.project?.name ?? null, taskName: e.task?.name ?? null,
      description: e.description, billable: e.billable, start: e.start, stop: e.stop,
      seconds: Math.floor((Date.parse(e.stop) - Date.parse(e.start)) / 1000), tags: e.tags.map(t => t.name), allDay: e.allDay });
  }
  return toTogglCsv(items, data.user, durationFormat);
}
export async function buildCsvExport<R extends Pick<Repositories, 'transfers'>>(runner: ExportRunner<R>, userId: number, range: { from?: string; to?: string }) {
  return assembleCsvExport(await collectAccountExport(runner, userId), range);
}
