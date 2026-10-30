import { canonicalTimeZone, dateKey } from '@tokkl/common/time';
import { badRequest } from '../lib/errors.ts';
import { parseInstant } from '../lib/values.ts';
import { createClient, setClientArchived, createProject, updateProject, createTask, resolveTagNames } from '../domain/catalogs.ts';
import { createTimeEntry, entryResolution, noTimeSpan, type EntryRepositories } from '../domain/timeEntries.ts';
import { createCatalogTimerEffects, type TimerPublication } from '../domain/timers.ts';
import type { OperationContext } from '../storage/contracts.ts';
import { EXPORT_FORMAT, LEGACY_EXPORT_FORMAT } from './storageExport.ts';
import { protectImport, importError, type ImportRunner } from './storageImportContext.ts';
import { importTogglCsv } from './storageImportCsv.ts';
export interface JsonImportResult {
  dry_run: boolean; clients: number; projects: number; tasks: number; tags: number;
  time_entries: number; skipped_duplicates: number; errors: Array<{ entity: string; id: unknown; message: string }>;
}
type Item = Record<string, unknown>;
function list(value: unknown, field: string): Item[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest(`Invalid export file: "${field}" must be an array`);
  return value.filter((item): item is Item => typeof item === 'object' && item !== null);
}
/** Joins the supplied operation. The outer runner controls dry-run rollback and retries. */
export async function importJsonExport(ctx: OperationContext<EntryRepositories>, userId: number, data: unknown,
  options: { dryRun: boolean }, publish: TimerPublication): Promise<JsonImportResult> {
  const format = typeof data === 'object' && data !== null ? (data as Item).format : undefined;
  if (format !== EXPORT_FORMAT && format !== LEGACY_EXPORT_FORMAT) throw badRequest('This is not a Tokkl JSON export');
  const file = data as Item, user = await protectImport(ctx, userId), wid = user.defaultWorkspaceId;
  const result: JsonImportResult = { dry_run: options.dryRun, clients: 0, projects: 0, tasks: 0, tags: 0, time_entries: 0, skipped_duplicates: 0, errors: [] };
  const clients = new Map<number, number>(), projects = new Map<number, number>(), tasks = new Map<number, number>(), tags = new Map<number, number>();
  function mapped(ids: Map<number, number>, value: unknown, entity: string): number | null {
    if (value === undefined || value === null) return null;
    const id = ids.get(Number(value));
    if (id === undefined) throw new Error(`Its ${entity} ${String(value)} was not imported`);
    return id;
  }
  async function unit(entity: string, item: Item, work: () => Promise<void>) {
    const counts = { ...result };
    try { await ctx.savepoint(work); }
    catch (error) {
      const message = importError(error, 'Invalid record');
      Object.assign(result, counts);
      if (result.errors.length < 100) result.errors.push({ entity, id: item.id, message });
    }
  }
  for (const item of list(file.clients, 'clients')) await unit('client', item, async () => {
    const name = String(item.name ?? '').trim();
    let found = await ctx.clients.findByName(wid, name);
    if (!found) {
      found = await createClient(ctx, wid, { name, notes: item.notes ?? null });
      if (item.archived === true) await setClientArchived(ctx, wid, found.id, true, createCatalogTimerEffects(ctx, publish));
      result.clients++;
    }
    clients.set(Number(item.id), found.id);
  });
  for (const item of list(file.projects, 'projects')) await unit('project', item, async () => {
    const name = String(item.name ?? '').trim(), clientId = mapped(clients, item.client_id, 'client');
    let found = await ctx.projects.findByName(wid, clientId, name);
    if (!found) {
      found = await createProject(ctx, wid, { name, client_id: clientId, color: item.color, active: item.active, billable: item.billable,
        estimated_hours: item.estimated_hours, rate: item.rate, currency: item.currency, fixed_fee: item.fixed_fee,
        start_date: item.start_date, end_date: item.end_date, is_private: item.is_private, template: item.template });
      result.projects++;
    }
    projects.set(Number(item.id), found.id);
  });
  for (const item of list(file.tasks, 'tasks')) await unit('task', item, async () => {
    const pid = mapped(projects, item.project_id, 'project'); if (pid === null) throw new Error('It has no project');
    const name = String(item.name ?? '').trim();
    let found = await ctx.tasks.findByName(wid, pid, name);
    if (!found) {
      const archived = !(await ctx.projects.getRef(wid, pid))!.active;
      const effects = createCatalogTimerEffects(ctx, publish);
      if (archived) await updateProject(ctx, wid, pid, { active: true }, effects);
      found = await createTask(ctx, wid, pid, { name, active: item.active, estimated_seconds: item.estimated_seconds });
      if (archived) await updateProject(ctx, wid, pid, { active: false }, effects);
      result.tasks++;
    }
    tasks.set(Number(item.id), found.id);
  });
  for (const item of list(file.tags, 'tags')) await unit('tag', item, async () => {
    const name = String(item.name ?? '').trim(), before = await ctx.tags.findByName(wid, name);
    const [id] = await resolveTagNames(ctx, wid, [name]);
    if (!before) result.tags++;
    tags.set(Number(item.id), id!);
  });
  const exporter = typeof file.user === 'object' && file.user !== null ? (file.user as Item).timezone : undefined;
  const zone = (typeof exporter === 'string' ? canonicalTimeZone(exporter) : null) ?? user.timezone;
  for (const item of list(file.time_entries, 'time_entries')) await unit('time_entry', item, async () => {
    if (item.server_deleted_at) return;
    let start = parseInstant(item.start, 'start'), stop = item.stop == null ? null : parseInstant(item.stop, 'stop');
    let noTime: { day: string; duration: number } | null = null;
    if (item.all_day === true && stop) {
      noTime = { day: dateKey(start, zone), duration: Math.floor(stop.getTime() / 1000) - Math.floor(start.getTime() / 1000) };
      ({ start, stop } = noTimeSpan(await entryResolution(ctx), user, noTime.day, noTime.duration, { exact: true }));
    }
    const projectId = mapped(projects, item.project_id, 'project'), taskId = mapped(tasks, item.task_id, 'task');
    const tagIds = Array.isArray(item.tag_ids) ? item.tag_ids.map(id => mapped(tags, id, 'tag')).filter((id): id is number => id !== null) : [];
    const description = typeof item.description === 'string' ? item.description : '';
    if (await ctx.entries.findDuplicate({ userId, start: start.toISOString(), stop: stop?.toISOString() ?? null, description, projectId })) {
      result.skipped_duplicates++; return;
    }
    if (!stop && await ctx.entries.running(userId)) throw new Error('Another timer is running here. Stop it and restore again to import this running entry');
    await createTimeEntry(ctx, user, wid, { description,
      ...(noTime ? { all_day: true, start_date: noTime.day, duration: noTime.duration } : { start: start.toISOString(), ...(stop ? { stop: stop.toISOString() } : { duration: -1 }) }),
      project_id: projectId, task_id: taskId, billable: item.billable === true, tag_ids: tagIds,
      created_with: typeof item.created_with === 'string' ? item.created_with : 'tokkl-json-import',
    }, publish, { exact: true });
    result.time_entries++;
  });
  return result;
}
/** Construct once with the application's shared ordered publication callback. */
export function createStorageImports<R extends EntryRepositories>(runner: ImportRunner<R>, publish: TimerPublication) {
  return {
    importJsonExport: (userId: number, data: unknown, options: { dryRun: boolean }) => runner.transaction(ctx => importJsonExport(ctx, userId, data, options, publish), { dryRun: options.dryRun }),
    importTogglCsv: (userId: number, text: string, options: { dryRun: boolean; users?: string[] }) => runner.transaction(ctx => importTogglCsv(ctx, userId, text, options, publish), { dryRun: options.dryRun }),
  };
}
