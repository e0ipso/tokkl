/**
 * A frozen copy of the whole-projection export pipeline: the account read into one projection, then
 * the JSON or CSV built from all of it at once. The export tests hold the streamed exports to the
 * bytes this copy writes from the same snapshot.
 */
import type { DurationFormat } from '@tokkl/types';
import { addDays, parseDateKey, startOfDay } from '@tokkl/common/time';
import type { AccountExportProjection } from '../../src/storage/domain.ts';
import { getPreferences } from '../../src/domain/accountValues.ts';
import {
  serializeClient,
  serializeProject,
  serializeTag,
  serializeTask,
  serializeTimeEntry,
  serializeUser,
  serializeWorkspace,
} from '../../src/presenters/toggl.ts';
import { EXPORT_FORMAT, toTogglCsv, type CsvItem } from '../../src/services/exports.ts';
import type { ExportAssemblyJob } from '../../src/services/exportJobs.ts';
import { invalidInput } from '../../src/lib/errors.ts';

export function assembleJsonExport(data: AccountExportProjection, exportedAt = new Date().toISOString()) {
  const publicUser = { ...data.user, passwordHash: '', apiToken: '' };
  const workspaces = new Map(data.workspaces.map(w => [w.id, w]));
  const memberships = new Map(data.memberships.map(m => [m.workspaceId, m.role]));
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exported_at: exportedAt,
    user: serializeUser(publicUser, { includeToken: false }),
    preferences: getPreferences(publicUser),
    workspaces: data.workspaces.map(w => serializeWorkspace(w, memberships.get(w.id))),
    clients: data.clients.map(serializeClient),
    projects: data.projects.map(p => serializeProject(p, workspaces.get(p.workspaceId)!.defaultCurrency)),
    tasks: data.tasks.map(serializeTask),
    tags: data.tags.map(serializeTag),
    time_entries: data.entries.map(e => serializeTimeEntry(e, { meta: true, user: publicUser })),
  };
}

export function assembleCsvExport(
  data: AccountExportProjection,
  range: { from?: string; to?: string },
  durationFormat: DurationFormat = 'improved',
): string {
  let from: string | undefined, to: string | undefined;
  if (range.from) {
    if (!parseDateKey(range.from)) throw invalidInput('Invalid start_date: expected YYYY-MM-DD');
    from = startOfDay(range.from, data.user.timezone).toISOString();
  }
  if (range.to) {
    if (!parseDateKey(range.to)) throw invalidInput('Invalid end_date: expected YYYY-MM-DD');
    to = startOfDay(addDays(range.to, 1), data.user.timezone).toISOString();
  }
  const items: CsvItem[] = [];
  for (const e of [...data.entries].reverse())
    if (e.stop && (!from || e.start >= from) && (!to || e.start < to)) {
      items.push({
        clientName: e.client?.name ?? null,
        projectName: e.project?.name ?? null,
        taskName: e.task?.name ?? null,
        description: e.description,
        billable: e.billable,
        start: e.start,
        stop: e.stop,
        seconds: Math.floor((Date.parse(e.stop) - Date.parse(e.start)) / 1000),
        tags: e.tags.map(t => t.name),
        allDay: e.allDay,
      });
    }
  return toTogglCsv(items, data.user, durationFormat);
}

/** The response body the export routes sent for `assembly` before exports streamed. */
export function oracleExportBody(data: AccountExportProjection, assembly: ExportAssemblyJob): string {
  return assembly.kind === 'export-json'
    ? JSON.stringify(assembleJsonExport(data, assembly.exportedAt))
    : assembleCsvExport(data, assembly.range, assembly.durationFormat);
}
