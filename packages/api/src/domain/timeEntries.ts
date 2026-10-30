import { MAX_ALL_DAY_SECONDS, MAX_DURATION_SECONDS } from '@tokkl/common/duration';
import { snapDuration, snapInstant, snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import { dateKey, parseDateKey, startOfDay } from '@tokkl/common/time';
import type { OperationContext, Repositories } from '../storage/contracts.ts';
import { StorageConflict } from '../storage/errors.ts';
import type { EntryDetails, TimeEntry, User } from '../storage/domain.ts';
import { badRequest, conflict, forbidden, notFound, type HttpError } from '../lib/errors.ts';
import { isoSeconds, optionalBool, optionalId, optionalString, parseInstant, togglTime } from '../lib/values.ts';
import { resolveTagNames } from './catalogs.ts';
import { touchTimer, type TimerPublication } from './timers.ts';

export type EntryRepositories = Pick<Repositories, 'users' | 'workspaces' | 'settings' | 'clients' | 'projects' | 'tasks' | 'tags' | 'entries' | 'timers'>;
export type EntryContext = OperationContext<EntryRepositories>;
export const MAX_DESCRIPTION_LENGTH = 3000;
export async function memberWorkspace(ctx: EntryRepositories, userId: number, wid: number) {
  const workspace = await ctx.workspaces.forMember(userId, wid);
  if (!workspace) throw forbidden('User does not have access to this resource.');
  return workspace;
}
export async function getTimeEntry(ctx: EntryRepositories, userId: number, id: number, options: { includeDeleted?: boolean } = {}): Promise<EntryDetails> {
  const row = await ctx.entries.get(userId, id, options.includeDeleted);
  if (!row) throw notFound('Time entry not found');
  return row;
}
/** Discover workspace guards before the stable user parent. Recheck discovery under that
 * parent; an overtaken discovery restarts the transaction instead of taking a lower guard. */
export async function protectEntryOperation(ctx: EntryContext, userId: number, workspaceIds: number[] = [], includeDefault = false): Promise<User> {
  const existing = await ctx.users.get(userId); if (!existing) throw notFound('User not found');
  const running = await ctx.entries.running(userId), pause = await ctx.timers.getPauseChain(userId);
  const ids = [...new Set([...workspaceIds, ...(includeDefault ? [existing.defaultWorkspaceId] : []),
    ...(running ? [running.workspaceId] : []), ...(pause ? [pause.workspaceId] : [])])];
  for (const wid of ids) if (!await ctx.workspaces.get(wid)) throw forbidden('User does not have access to this resource.');
  await ctx.lockWorkspaces(ids); await ctx.lockUserTimer(userId);
  const user = await ctx.users.get(userId); if (!user) throw notFound('User not found');
  const current = await ctx.entries.running(userId), chain = await ctx.timers.getPauseChain(userId);
  if ((current && !ids.includes(current.workspaceId)) || (chain && !ids.includes(chain.workspaceId))
    || (includeDefault && !ids.includes(user.defaultWorkspaceId))) throw new StorageConflict('serialization');
  return user;
}
export async function entryResolution(ctx: EntryRepositories): Promise<number> { const value = (await ctx.settings.read()).timeResolutionMinutes; return value !== undefined && [1,2,3,4,5,6,10,12,15,20,30,60].includes(value) ? value : 5; }

interface Draft {
  projectId: number | null;
  taskId: number | null;
  description: string;
  start: Date;
  stop: Date | null;
  billable: boolean;
  tagIds: number[];
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** `date` truncated to whole seconds, the precision the database stores. */
function wholeSeconds(date: Date): Date {
  return new Date(seconds(date) * 1000);
}

/**
 * Snaps a stopped span to the instance resolution on the clock of the owner's timezone, or returns
 * null when it is too short to keep (see `snapSpan`).
 */
function snapToResolution(resolution: number, user: User, start: Date, stop: Date): SnappedSpan | null {
  return snapSpan(wholeSeconds(start), wholeSeconds(stop), resolution, user.timezone);
}

function tooShort(resolution: number): HttpError {
  return badRequest(`Time entry is too short: it rounds to zero at the ${resolution}-minute time resolution`);
}

function applyTagAction(current: number[], incoming: number[] | undefined, action: unknown): number[] {
  if (incoming === undefined) return current;
  if (action === 'add') return [...new Set([...current, ...incoming])];
  if (action === 'delete' || action === 'remove') return current.filter((id) => !incoming.includes(id));
  return incoming;
}

function readDuration(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest('Invalid duration: expected an integer');
  return Math.trunc(value);
}

function readStartDate(body: Record<string, unknown>): string | undefined {
  if (body.start_date === undefined || body.start_date === null) return undefined;
  if (typeof body.start_date !== 'string' || !parseDateKey(body.start_date)) {
    throw badRequest('Invalid start_date: expected YYYY-MM-DD');
  }
  return body.start_date;
}

function readStart(body: Record<string, unknown>, fallback: Date): Date {
  const value = body.start ?? fallback.toISOString();
  const start = parseInstant(value, 'start');
  const day = readStartDate(body);
  if (day === undefined) return start;
  return parseInstant(`${day}${(value as string).slice(10)}`, 'start');
}

function assertConsistentDuration(start: Date, stop: Date | null, duration: number | undefined, body: Record<string, unknown>): void {
  if (body.stop != null && stop && duration !== undefined && seconds(stop) - seconds(start) !== duration) {
    throw badRequest('Stop and duration must be consistent with start');
  }
}

function assertWorkspace(body: Record<string, unknown>, wid: number): void {
  const bodyWid = optionalId(body.workspace_id ?? body.wid, 'workspace_id');
  if (bodyWid && bodyWid !== wid) throw badRequest('Workspace ID in the body does not match the URL');
}

/**
 * Validates a stopped draft and, unless `exact` is set, snaps its start and stop to the instance
 * resolution. A span too short to keep is refused, unless the edit left the stored times alone
 * (`unchanged`): those stay as they are, so an older zero-length entry can still be renamed. The
 * 999-hour cap applies to the snapped span. A running draft keeps its exact start.
 */
function settleSpan(resolution: number, user: User, draft: Draft, { exact = false, unchanged = false } = {}): void {
  if (!draft.stop) return;
  if (seconds(draft.stop) < seconds(draft.start)) throw badRequest('Stop time must be after start time');
  if (!exact) {
    const snapped = snapToResolution(resolution, user, draft.start, draft.stop);
    if (snapped) Object.assign(draft, snapped);
    else if (!unchanged) throw tooShort(resolution);
  }
  if (seconds(draft.stop) - seconds(draft.start) > MAX_DURATION_SECONDS) {
    throw badRequest('Time entries can not be longer than 999 hours');
  }
}

/**
 * The stored span of a no-time entry: local midnight of `day` in the owner's timezone, and that
 * plus the duration. Live writes snap the duration; imports pass `exact`.
 */
export function noTimeSpan(
  resolution: number, user: User, day: string, duration: number, { exact = false } = {},
): SnappedSpan {
  if (duration < 0) throw badRequest('No-time entries can not be running');
  const kept = exact ? Math.trunc(duration) : snapDuration(duration, resolution);
  if (kept <= 0) throw exact ? badRequest('Time entry is too short') : tooShort(resolution);
  if (kept > MAX_ALL_DAY_SECONDS) throw badRequest('No-time entries can not be longer than 24 hours');
  const start = startOfDay(day, user.timezone);
  return { start, stop: new Date(start.getTime() + kept * 1000) };
}


function readNoTimeSpan(resolution: number, user: User, body: Record<string, unknown>, exact: boolean): SnappedSpan {
  const start = body.start === undefined || body.start === null ? undefined : parseInstant(body.start, 'start');
  let duration = readDuration(body.duration);
  if (start && body.stop !== undefined && body.stop !== null) {
    const stop = parseInstant(body.stop, 'stop');
    if (seconds(stop) < seconds(start)) throw badRequest('Stop time must be after start time');
    assertConsistentDuration(start, stop, duration, body);
    duration ??= seconds(stop) - seconds(start);
  }
  if (duration === undefined) throw badRequest('No-time entries need a duration');
  const day = readStartDate(body) ?? dateKey(start ?? new Date(), user.timezone);
  return noTimeSpan(resolution, user, day, duration, { exact });
}

/**
 * The span of a no-time entry from an update body. The day is `start_date`, else the local date of
 * `start`, else the entry's own. The duration is `duration`, else `stop - start` when the entry is
 * being turned on, else its own. Once an entry has no times, a `start` must be local midnight and a
 * `stop` must be the anchored stop. An edit that keeps the day and the duration keeps the stored
 * span, so an imported entry off the grid can still be renamed.
 */
function readNoTimeUpdate(resolution: number, user: User, current: TimeEntry, body: Record<string, unknown>): SnappedSpan {
  if (!current.stop) throw badRequest('No-time entries can not be running');
  const wasAllDay = current.allDay;
  const currentStart = new Date(current.start);
  const currentStop = new Date(current.stop);
  const start = body.start == null ? undefined : parseInstant(body.start, 'start');
  const stop = body.stop == null ? undefined : parseInstant(body.stop, 'stop');
  let duration = readDuration(body.duration);
  if (duration !== undefined && duration < 0) throw badRequest('No-time entries can not be running');
  if (wasAllDay && start && seconds(start) !== seconds(startOfDay(dateKey(start, user.timezone), user.timezone))) {
    throw badRequest('No-time entries have no start time: change start_date or duration instead');
  }
  if (!wasAllDay && stop) {
    const from = start ?? currentStart;
    if (seconds(stop) < seconds(from)) throw badRequest('Stop time must be after start time');
    assertConsistentDuration(from, stop, duration, body);
    duration ??= seconds(stop) - seconds(from);
  }
  const currentDay = dateKey(currentStart, user.timezone);
  const currentDuration = seconds(currentStop) - seconds(currentStart);
  const day = readStartDate(body) ?? (start ? dateKey(start, user.timezone) : currentDay);
  duration ??= currentDuration;
  const span = wasAllDay && day === currentDay && duration === currentDuration
    ? { start: currentStart, stop: currentStop }
    : noTimeSpan(resolution, user, day, duration);
  if (wasAllDay && stop && seconds(stop) !== seconds(span.stop)) {
    throw badRequest('No-time entries have no end time: change duration instead');
  }
  return span;
}

async function readTagIds(ctx: EntryContext, wid: number, body: Record<string, unknown>): Promise<number[] | undefined> {
  let ids: number[] | undefined;
  if (body.tag_ids != null) {
    if (!Array.isArray(body.tag_ids)) throw badRequest('Invalid tag_ids: expected an array');
    ids = body.tag_ids.map(value => { const id = optionalId(value, 'tag_ids'); if (!id) throw badRequest('Invalid tag_ids'); return id; });
    const found = await ctx.tags.findByIds(wid, ids);
    for (const id of ids) if (!found.some(tag => tag.id === id)) throw notFound('Tag not found');
  }
  if (body.tags != null) {
    if (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')) throw badRequest('Invalid tags: expected an array of strings');
    ids = [...(ids ?? []), ...await resolveTagNames(ctx, wid, body.tags as string[])];
  }
  return ids === undefined ? undefined : [...new Set(ids)];
}
async function resolveProjectAndTask(ctx: EntryContext, wid: number, body: Record<string, unknown>, current: { projectId: number | null; taskId: number | null }) {
  const projectInput = optionalId(body.project_id !== undefined ? body.project_id : body.pid, 'project_id');
  const taskInput = optionalId(body.task_id !== undefined ? body.task_id : body.tid, 'task_id');
  let projectId = projectInput === undefined ? current.projectId : projectInput;
  let taskId = taskInput === undefined ? current.taskId : taskInput;
  if (projectInput !== undefined && taskInput === undefined && projectInput !== current.projectId) taskId = null;
  if (taskId !== null) {
    const task = await ctx.tasks.getRef(wid, taskId); if (!task) throw notFound('Task not found');
    if (projectId === null) projectId = task.projectId;
    else if (task.projectId !== projectId) throw badRequest('Task does not belong to the project');
  }
  const project = projectId === null ? null : await ctx.projects.getRef(wid, projectId);
  if (projectId !== null && !project) throw notFound('Project not found');
  return { projectId, taskId, project, projectChanged: projectInput !== undefined && projectInput !== current.projectId };
}
/** Caller holds the user's guard. This helper does not acquire a workspace guard. */
export async function reanchorNoTimeEntries(ctx: EntryContext, userId: number, fromZone: string, toZone: string): Promise<void> {
  for (const row of await ctx.entries.listAllDay(userId)) {
    const old = new Date(row.start), duration = seconds(new Date(row.stop!)) - seconds(old);
    const start = startOfDay(dateKey(old, fromZone), toZone);
    if (seconds(start) === seconds(old)) continue;
    await ctx.entries.update(userId, row.workspaceId, row.id, { start: start.toISOString(), stop: new Date(start.getTime() + duration * 1000).toISOString() });
  }
}
export async function stopEntryAt(ctx: EntryContext, user: User, entry: TimeEntry, at: Date): Promise<boolean> {
  const resolution = await entryResolution(ctx), start = new Date(entry.start);
  const snapped = snapToResolution(resolution, user, start, at < start ? start : at);
  if (!snapped) {
    const point = new Date(isoSeconds(snapInstant(wholeSeconds(start), resolution, user.timezone))).toISOString();
    await ctx.entries.update(user.id, entry.workspaceId, entry.id, { start: point, stop: point, deletedAt: new Date().toISOString() });
    return false;
  }
  await ctx.entries.update(user.id, entry.workspaceId, entry.id, { start: snapped.start.toISOString(),
    stop: new Date(Math.min(snapped.stop.getTime(), snapped.start.getTime() + MAX_DURATION_SECONDS * 1000)).toISOString() });
  return true;
}
async function stopRunning(ctx: EntryContext, user: User, at: Date, exceptId?: number): Promise<void> {
  const running = await ctx.entries.running(user.id);
  if (!running || running.id === exceptId) return;
  await stopEntryAt(ctx, user, running, at < new Date(running.start) ? new Date() : at);
}
export function currentTagIds(row: EntryDetails): number[] { return row.tags.map(tag => tag.id); }
export interface CreateOptions { exact?: boolean }
export async function createTimeEntry(ctx: EntryContext, seen: User, wid: number, body: Record<string, unknown>, publish: TimerPublication, options: CreateOptions = {}): Promise<EntryDetails> {
  return ctx.transaction(async ctx => {
    const user = await protectEntryOperation(ctx, seen.id, [wid]); await memberWorkspace(ctx, user.id, wid);
    touchTimer(ctx, user.id, publish); assertWorkspace(body, wid);
    const resolution = await entryResolution(ctx), exact = options.exact === true;
    const allDay = optionalBool(body.all_day, 'all_day') === true;
    let start: Date, stop: Date | null = null;
    if (allDay) ({ start, stop } = readNoTimeSpan(resolution, user, body, exact));
    else {
      start = readStart(body, new Date()); const duration = readDuration(body.duration);
      if (body.stop != null) stop = parseInstant(body.stop, 'stop');
      else if (duration !== undefined && duration >= 0) stop = new Date(start.getTime() + duration * 1000);
      assertConsistentDuration(start, stop, duration, body);
    }
    const { projectId, taskId, project } = await resolveProjectAndTask(ctx, wid, body, { projectId: null, taskId: null });
    const draft: Draft = { projectId, taskId, description: optionalString(body.description, 'description', MAX_DESCRIPTION_LENGTH) ?? '',
      start, stop, billable: optionalBool(body.billable, 'billable') ?? project?.billable ?? false, tagIds: await readTagIds(ctx, wid, body) ?? [] };
    if (!allDay) settleSpan(resolution, user, draft, { exact });
    if (!draft.stop) await stopRunning(ctx, user, draft.start);
    return ctx.entries.create({ userId: user.id, workspaceId: wid, projectId, taskId, description: draft.description,
      start: new Date(isoSeconds(draft.start)).toISOString(), stop: draft.stop ? new Date(isoSeconds(draft.stop)).toISOString() : null,
      billable: draft.billable, allDay, durationOnly: true, createdWith: optionalString(body.created_with, 'created_with', 255) ?? 'api', deletedAt: null, tagIds: draft.tagIds });
  });
}
export async function updateTimeEntry(ctx: EntryContext, seen: User, wid: number, id: number, body: Record<string, unknown>, publish: TimerPublication): Promise<EntryDetails> {
  return ctx.transaction(async ctx => {
    const user = await protectEntryOperation(ctx, seen.id, [wid]); await memberWorkspace(ctx, user.id, wid);
    touchTimer(ctx, user.id, publish); assertWorkspace(body, wid);
    const current = await getTimeEntry(ctx, user.id, id); if (current.workspaceId !== wid) throw notFound('Time entry not found');
    const resolution = await entryResolution(ctx), currentStart = new Date(current.start), currentStop = current.stop ? new Date(current.stop) : null;
    const wasAllDay = current.allDay, allDay = optionalBool(body.all_day, 'all_day') ?? wasAllDay;
    let start: Date, stop: Date | null, unchanged = false;
    if (allDay) ({ start, stop } = readNoTimeUpdate(resolution, user, current, body));
    else {
      if (wasAllDay && (body.start == null || body.stop == null)) throw badRequest('Turning off all_day needs a start and a stop');
      start = readStart(body, currentStart); const duration = readDuration(body.duration); stop = currentStop;
      if (body.stop != null) stop = parseInstant(body.stop, 'stop');
      else if (duration !== undefined) stop = duration >= 0 ? new Date(start.getTime() + duration * 1000) : null;
      assertConsistentDuration(start, stop, duration, body);
      unchanged = !wasAllDay && seconds(start) === seconds(currentStart) && stop?.getTime() === currentStop?.getTime();
    }
    const { projectId, taskId, project, projectChanged } = await resolveProjectAndTask(ctx, wid, body, current);
    const billableInput = optionalBool(body.billable, 'billable');
    const draft: Draft = { projectId, taskId, start, stop,
      description: optionalString(body.description, 'description', MAX_DESCRIPTION_LENGTH) ?? current.description,
      billable: billableInput ?? (projectChanged && project ? project.billable : current.billable),
      tagIds: applyTagAction(currentTagIds(current), await readTagIds(ctx, wid, body), body.tag_action) };
    if (!allDay) settleSpan(resolution, user, draft, { unchanged });
    if (!draft.stop && currentStop) await stopRunning(ctx, user, new Date(), id);
    return ctx.entries.update(user.id, wid, id, { projectId, taskId, description: draft.description,
      start: new Date(isoSeconds(draft.start)).toISOString(), stop: draft.stop ? new Date(isoSeconds(draft.stop)).toISOString() : null,
      billable: draft.billable, allDay, tagIds: draft.tagIds });
  });
}
export async function stopTimeEntry(ctx: EntryContext, seen: User, wid: number, id: number, publish: TimerPublication, stop?: unknown): Promise<EntryDetails> {
  const at = stop === undefined ? new Date() : parseInstant(stop, 'stop');
  return ctx.transaction(async ctx => {
    const user = await protectEntryOperation(ctx, seen.id, [wid]); await memberWorkspace(ctx, user.id, wid); touchTimer(ctx, user.id, publish);
    const current = await getTimeEntry(ctx, user.id, id); if (current.workspaceId !== wid) throw notFound('Time entry not found');
    if (current.stop) throw conflict('Time entry already stopped');
    await stopEntryAt(ctx, user, current, at); return getTimeEntry(ctx, user.id, id, { includeDeleted: true });
  });
}
export async function deleteTimeEntry(ctx: EntryContext, userId: number, wid: number, id: number, publish: TimerPublication): Promise<void> {
  await ctx.transaction(async ctx => {
    await protectEntryOperation(ctx, userId, [wid]); await memberWorkspace(ctx, userId, wid); touchTimer(ctx, userId, publish);
    const current = await getTimeEntry(ctx, userId, id); if (current.workspaceId !== wid) throw notFound('Time entry not found');
    await ctx.entries.softDelete(userId, wid, id, new Date().toISOString());
  });
}
export async function restoreTimeEntry(ctx: EntryContext, seen: User, id: number, publish: TimerPublication): Promise<EntryDetails> {
  return ctx.transaction(async ctx => {
    const candidate = await getTimeEntry(ctx, seen.id, id, { includeDeleted: true });
    const user = await protectEntryOperation(ctx, seen.id, [candidate.workspaceId]);
    const current = await getTimeEntry(ctx, user.id, id, { includeDeleted: true }); await memberWorkspace(ctx, user.id, current.workspaceId);
    touchTimer(ctx, user.id, publish); if (!current.deletedAt) return current;
    if (!current.stop && await ctx.entries.running(user.id) && !await stopEntryAt(ctx, user, current, new Date())) return getTimeEntry(ctx, user.id, id, { includeDeleted: true });
    return ctx.entries.restore(user.id, id);
  });
}
export async function purgeDeletedEntries(ctx: EntryContext, userId: number, publish: TimerPublication, id?: number): Promise<number> {
  return ctx.transaction(async ctx => { await protectEntryOperation(ctx, userId); touchTimer(ctx, userId, publish); return ctx.entries.purgeDeleted(userId, id); });
}

export interface PatchOperation {
  op: string;
  path: string;
  value?: unknown;
}

const PATCH_FIELDS: Record<string, string> = {
  '/description': 'description',
  '/project_id': 'project_id',
  '/pid': 'project_id',
  '/task_id': 'task_id',
  '/tid': 'task_id',
  '/billable': 'billable',
  '/start': 'start',
  '/stop': 'stop',
  '/duration': 'duration',
  '/tags': 'tags',
  '/tag_ids': 'tag_ids',
};

function operationToBody(operation: PatchOperation): Record<string, unknown> {
  const field = PATCH_FIELDS[operation.path];
  if (!field) throw badRequest(`Unsupported path ${operation.path}`);
  if (!['add', 'remove', 'replace'].includes(operation.op)) throw badRequest(`Unsupported operation ${operation.op}`);
  if (field === 'tags' || field === 'tag_ids') {
    const action = operation.op === 'add' ? 'add' : operation.op === 'remove' ? 'delete' : undefined;
    const value = operation.op === 'remove' && operation.value === undefined ? null : operation.value;
    if (value === null) return { [field]: [] };
    return { [field]: value, tag_action: action };
  }
  if (operation.op === 'remove') {
    if (field === 'description') return { description: '' };
    if (field === 'project_id' || field === 'task_id') return { [field]: null };
    throw badRequest(`Cannot remove ${operation.path}`);
  }
  return { [field]: operation.value };
}


export async function patchTimeEntries(ctx: EntryContext, seen: User, wid: number, ids: number[], operations: unknown, publish: TimerPublication) {
  if (!Array.isArray(operations) || operations.length === 0) throw badRequest('Expected an array of patch operations');
  return ctx.transaction(async ctx => {
    const user = await protectEntryOperation(ctx, seen.id, [wid]); await memberWorkspace(ctx, user.id, wid);
    const success: number[] = [], failure: Array<{ id: number; message: string }> = [];
    for (const id of ids) {
      try {
        await ctx.savepoint(async sp => {
          for (const raw of operations as PatchOperation[]) {
            if (!raw || typeof raw.op !== 'string' || typeof raw.path !== 'string') throw badRequest('Invalid patch operation');
            if ((raw.path === '/start' || raw.path === '/stop') && (await getTimeEntry(sp, user.id, id)).allDay) throw badRequest('No-time entries have no start or end time');
            await updateTimeEntry(sp, user, wid, id, operationToBody(raw), publish);
          }
        });
        success.push(id);
      } catch (error) { failure.push({ id, message: error instanceof Error ? error.message : 'Failed' }); }
    }
    return { success, failure };
  });
}

export function entryDurationSeconds(row: Pick<TimeEntry, 'start' | 'stop'>, now = new Date()): number {
  return seconds(row.stop ? new Date(row.stop) : now) - seconds(new Date(row.start));
}

export function serializeTimeEntry(row: EntryDetails, options: { meta?: boolean; user?: User } = {}) {
  const tags = row.tags;
  const start = new Date(row.start);
  const duration = row.stop ? seconds(new Date(row.stop)) - seconds(start) : -seconds(start);
  const entry: Record<string, unknown> = {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    task_id: row.taskId,
    billable: row.billable,
    start: togglTime(row.start),
    stop: togglTime(row.stop),
    duration,
    description: row.description,
    tags: tags.map((tag) => tag.name),
    tag_ids: tags.map((tag) => tag.id),
    duronly: true,
    all_day: row.allDay,
    at: togglTime(row.updatedAt),
    server_deleted_at: togglTime(row.deletedAt),
    user_id: row.userId,
    uid: row.userId,
    wid: row.workspaceId,
    pid: row.projectId,
    tid: row.taskId,
    permissions: null,
    expense_ids: [],
  };
  if (options.meta) {
    Object.assign(entry, {
      project_name: row.project?.name ?? null,
      project_color: row.project?.color ?? null,
      project_active: row.project?.active ?? null,
      project_billable: row.project?.billable ?? null,
      client_id: row.client?.id ?? null,
      client_name: row.client?.name ?? null,
      task_name: row.task?.name ?? null,
      task_active: row.task?.active ?? null,
      user_name: options.user?.fullName ?? null,
      user_avatar_url: '',
    });
  }
  return entry;
}
