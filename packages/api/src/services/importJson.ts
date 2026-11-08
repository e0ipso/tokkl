import { canonicalTimeZone, dateKey } from '@tokkl/common/time';
import { invalidInput } from '../lib/errors.ts';
import { parseInstant } from '../lib/values.ts';
import {
  createClient,
  setClientArchived,
  createProject,
  updateProject,
  createTask,
  resolveTagNames,
} from '../domain/catalogs.ts';
import { parseNewClient, parseNewProject, parseNewTask } from '../commands/catalogs.ts';
import { parseNewEntry } from '../commands/timeEntries.ts';
import type { EntryRepositories } from '../domain/entryAccess.ts';
import { withExactEntryImport, type ExactEntryImport } from '../domain/entryImport.ts';
import { noTimeSpan } from '../domain/entrySpans.ts';
import { createCatalogTimerEffects } from '../domain/timerEffects.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import type { OperationContext } from '../domain/ports.ts';
import type { User } from '../domain/model.ts';
import { EXPORT_FORMAT, LEGACY_EXPORT_FORMAT } from './exports.ts';
import {
  MAX_IMPORT_ERRORS,
  cancelBeforeCommit,
  checkCancelled,
  importError,
  protectImport,
  type ImportRunner,
} from './importGuards.ts';
import { importTogglCsv, readTogglCsv } from './importCsv.ts';
export interface JsonImportResult {
  dry_run: boolean;
  clients: number;
  projects: number;
  tasks: number;
  tags: number;
  time_entries: number;
  skipped_duplicates: number;
  errors: Array<{ entity: string; id: unknown; message: string }>;
}
type Item = Record<string, unknown>;
/** `signal` is the request's: once it aborts, the import stops and rolls back. */
export interface ImportOptions {
  dryRun: boolean;
  signal?: AbortSignal;
}
function list(value: unknown, field: string): Item[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidInput(`Invalid export file: "${field}" must be an array`);
  return value.filter((item): item is Item => typeof item === 'object' && item !== null);
}
/** What every restore step shares: the guarded operation, the target and the id maps built so far. */
interface Restore {
  ctx: OperationContext<EntryRepositories>;
  userId: number;
  user: User;
  wid: number;
  publish: TimerPublication;
  result: JsonImportResult;
  /** File id to stored id, per entity, for the records restored or matched by name. */
  ids: Record<'client' | 'project' | 'task' | 'tag', Map<number, number>>;
}

/** The stored id for a file reference, null for no reference, or a skip reason when it was not imported. */
function mapped(restore: Restore, entity: keyof Restore['ids'], value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const id = restore.ids[entity].get(Number(value));
  if (id === undefined) throw new Error(`Its ${entity} ${String(value)} was not imported`);
  return id;
}

/** Runs one record in its own savepoint. A failure rolls the record back and is reported, not thrown. */
async function unit(
  restore: Restore,
  entity: string,
  item: Item,
  work: () => Promise<void>,
  savepoint = (work: () => Promise<void>) => restore.ctx.savepoint(work),
): Promise<void> {
  const { result } = restore;
  const counts = { ...result };
  try {
    await savepoint(work);
  } catch (error) {
    const message = importError(error, 'Invalid record');
    Object.assign(result, counts);
    if (result.errors.length < MAX_IMPORT_ERRORS) result.errors.push({ entity, id: item.id, message });
  }
}

const nameOf = (item: Item) => String(item.name ?? '').trim();

async function restoreClient(restore: Restore, item: Item): Promise<void> {
  const { ctx, wid } = restore;
  let found = await ctx.clients.findByName(wid, nameOf(item));
  if (!found) {
    found = await createClient(ctx, wid, parseNewClient({ name: nameOf(item), notes: item.notes ?? null }));
    if (item.archived === true)
      await setClientArchived(ctx, wid, found.id, true, createCatalogTimerEffects(ctx, restore.publish));
    restore.result.clients++;
  }
  restore.ids.client.set(Number(item.id), found.id);
}

async function restoreProject(restore: Restore, item: Item): Promise<void> {
  const { ctx, wid } = restore;
  const name = nameOf(item),
    clientId = mapped(restore, 'client', item.client_id);
  let found = await ctx.projects.findByName(wid, clientId, name);
  if (!found) {
    found = await createProject(
      ctx,
      wid,
      parseNewProject({
        name,
        client_id: clientId,
        color: item.color,
        active: item.active,
        billable: item.billable,
        estimated_hours: item.estimated_hours,
        rate: item.rate,
        currency: item.currency,
        fixed_fee: item.fixed_fee,
        start_date: item.start_date,
        end_date: item.end_date,
        is_private: item.is_private,
        template: item.template,
      }),
    );
    restore.result.projects++;
  }
  restore.ids.project.set(Number(item.id), found.id);
}

/** Tasks cannot be created in an archived project, so the project is reopened for the task. */
async function restoreTask(restore: Restore, item: Item): Promise<void> {
  const { ctx, wid } = restore;
  const pid = mapped(restore, 'project', item.project_id);
  if (pid === null) throw new Error('It has no project');
  let found = await ctx.tasks.findByName(wid, pid, nameOf(item));
  if (!found) {
    const archived = !(await ctx.projects.getRef(wid, pid))!.active;
    const effects = createCatalogTimerEffects(ctx, restore.publish);
    if (archived) await updateProject(ctx, wid, pid, { active: true }, effects);
    found = await createTask(
      ctx,
      wid,
      pid,
      parseNewTask({ name: nameOf(item), active: item.active, estimated_seconds: item.estimated_seconds }),
    );
    if (archived) await updateProject(ctx, wid, pid, { active: false }, effects);
    restore.result.tasks++;
  }
  restore.ids.task.set(Number(item.id), found.id);
}

async function restoreTag(restore: Restore, item: Item): Promise<void> {
  const { ctx, wid } = restore;
  const before = await ctx.tags.findByName(wid, nameOf(item));
  const [id] = await resolveTagNames(ctx, wid, [nameOf(item)]);
  if (!before) restore.result.tags++;
  restore.ids.tag.set(Number(item.id), id!);
}

/** Entries keep their exact times. A no-time entry is anchored to its day in the exporter's zone. */
async function restoreEntry(restore: Restore, writer: ExactEntryImport, zone: string, item: Item): Promise<void> {
  const { ctx, userId, user } = restore;
  if (item.server_deleted_at) return;
  let start = parseInstant(item.start, 'start'),
    stop = item.stop == null ? null : parseInstant(item.stop, 'stop');
  let noTime: { day: string; duration: number } | null = null;
  if (item.all_day === true && stop) {
    noTime = {
      day: dateKey(start, zone),
      duration: Math.floor(stop.getTime() / 1000) - Math.floor(start.getTime() / 1000),
    };
    ({ start, stop } = noTimeSpan(1, user, noTime.day, noTime.duration, { exact: true }));
  }
  const projectId = mapped(restore, 'project', item.project_id),
    taskId = mapped(restore, 'task', item.task_id);
  const tagIds = Array.isArray(item.tag_ids)
    ? item.tag_ids.map(id => mapped(restore, 'tag', id)).filter((id): id is number => id !== null)
    : [];
  const description = typeof item.description === 'string' ? item.description : '';
  const duplicate = await ctx.entries.findDuplicate({
    userId,
    start: start.toISOString(),
    stop: stop?.toISOString() ?? null,
    description,
    projectId,
  });
  if (duplicate) {
    restore.result.skipped_duplicates++;
    return;
  }
  if (!stop && (await ctx.entries.running(userId)))
    throw new Error('Another timer is running here. Stop it and restore again to import this running entry');
  await writer.create(
    parseNewEntry({
      description,
      ...(noTime
        ? { all_day: true, start_date: noTime.day, duration: noTime.duration }
        : { start: start.toISOString(), ...(stop ? { stop: stop.toISOString() } : { duration: -1 }) }),
      project_id: projectId,
      task_id: taskId,
      billable: item.billable === true,
      tag_ids: tagIds,
      created_with: typeof item.created_with === 'string' ? item.created_with : 'tokkl-json-import',
    }),
  );
  restore.result.time_entries++;
}

/** The exporter's zone when the file names a valid one, else the importing user's. */
function exporterZone(file: Item, user: User): string {
  const exporter = typeof file.user === 'object' && file.user !== null ? (file.user as Item).timezone : undefined;
  return (typeof exporter === 'string' ? canonicalTimeZone(exporter) : null) ?? user.timezone;
}

/** `data` as a Tokkl JSON export, or a 400 when it names no format this server restores. */
function exportFile(data: unknown): Item {
  const format = typeof data === 'object' && data !== null ? (data as Item).format : undefined;
  if (format !== EXPORT_FORMAT && format !== LEGACY_EXPORT_FORMAT)
    throw invalidInput('This is not a Tokkl JSON export');
  return data as Item;
}

/**
 * Restores a Tokkl JSON export into the user's default workspace: catalogs first, matched by name,
 * then entries, skipping duplicates. Runs in the caller's transaction; the outer runner controls
 * the dry-run rollback and retries.
 */
async function importJsonExport(
  ctx: OperationContext<EntryRepositories>,
  userId: number,
  file: Item,
  options: ImportOptions,
  publish: TimerPublication,
): Promise<JsonImportResult> {
  const { signal } = options;
  const user = await protectImport(ctx, userId);
  const restore: Restore = {
    ctx,
    userId,
    user,
    wid: user.defaultWorkspaceId,
    publish,
    result: {
      dry_run: options.dryRun,
      clients: 0,
      projects: 0,
      tasks: 0,
      tags: 0,
      time_entries: 0,
      skipped_duplicates: 0,
      errors: [],
    },
    ids: { client: new Map(), project: new Map(), task: new Map(), tag: new Map() },
  };
  const catalogs = [
    ['clients', 'client', restoreClient],
    ['projects', 'project', restoreProject],
    ['tasks', 'task', restoreTask],
    ['tags', 'tag', restoreTag],
  ] as const;
  // Each record checks the request before its savepoint, which would report a failure as the record's.
  for (const [field, entity, step] of catalogs)
    for (const item of list(file[field], field)) {
      checkCancelled(signal);
      await unit(restore, entity, item, () => step(restore, item));
    }
  const zone = exporterZone(file, user);
  await withExactEntryImport(ctx, userId, restore.wid, publish, async writer => {
    for (const item of list(file.time_entries, 'time_entries')) {
      checkCancelled(signal);
      await unit(restore, 'time_entry', item, () => restoreEntry(restore, writer, zone, item), writer.savepoint);
    }
  });
  cancelBeforeCommit(ctx, signal);
  return restore.result;
}
/** Construct once with the application's shared ordered publication callback. */
export function createImportOperations<R extends EntryRepositories>(
  runner: ImportRunner<R>,
  publish: TimerPublication,
) {
  return {
    /** The file's format is checked before the transaction opens. */
    async importJsonExport(userId: number, data: unknown, options: ImportOptions) {
      const file = exportFile(data);
      checkCancelled(options.signal);
      return runner.transaction(ctx => importJsonExport(ctx, userId, file, options, publish), {
        dryRun: options.dryRun,
      });
    },
    /**
     * The file is parsed before the transaction opens. Not an async function on purpose: only the
     * parse holds `text`, so the file's text is released before the transaction runs.
     */
    importTogglCsv(userId: number, text: string, options: ImportOptions & { users?: string[] }) {
      return readTogglCsv(text).then(table => {
        checkCancelled(options.signal);
        return runner.transaction(ctx => importTogglCsv(ctx, userId, table, options, publish), {
          dryRun: options.dryRun,
        });
      });
    },
  };
}
