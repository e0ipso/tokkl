import { MAX_DURATION_SECONDS } from '@tokkl/common/duration';
import { snapInstant, snapSpan, type SnappedSpan } from '@tokkl/common/snap';
import { parseDateKey } from '@tokkl/common/time';
import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { badRequest, conflict, type HttpError, notFound } from '../lib/errors.ts';
import {
  asBool, isoSeconds, optionalBool, optionalId, optionalString, parseInstant, togglTime,
} from '../lib/values.ts';
import { getProjectRef, type ProjectRef } from './projects.ts';
import { getTimeResolutionMinutes } from './settings.ts';
import { getTag, resolveTagNames } from './tags.ts';
import { getTaskRef } from './tasks.ts';
import { touchTimer } from './timerState.ts';
import type { UserRow } from './users.ts';
import { memberWorkspace } from './workspaces.ts';

export const MAX_DESCRIPTION_LENGTH = 3000;

export interface TimeEntryRow {
  id: number;
  workspace_id: number;
  user_id: number;
  project_id: number | null;
  task_id: number | null;
  description: string;
  start: string;
  stop: string | null;
  billable: number;
  duronly: number;
  created_with: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TimeEntryWithMeta extends TimeEntryRow {
  tags_json: string;
  project_name: string | null;
  project_color: string | null;
  project_active: number | null;
  project_billable: number | null;
  client_id: number | null;
  client_name: string | null;
  task_name: string | null;
  task_active: number | null;
}

const SELECT_WITH_META = `
  SELECT te.*,
    (SELECT json_group_array(json_object('id', id, 'name', name)) FROM (
       SELECT tg.id, tg.name FROM time_entry_tags tet JOIN tags tg ON tg.id = tet.tag_id
       WHERE tet.time_entry_id = te.id ORDER BY tg.name COLLATE NOCASE)) AS tags_json,
    p.name AS project_name, p.color AS project_color, p.active AS project_active, p.billable AS project_billable,
    c.id AS client_id, c.name AS client_name, t.name AS task_name, t.active AS task_active
  FROM time_entries te
  LEFT JOIN projects p ON p.id = te.project_id
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN tasks t ON t.id = te.task_id
`;

export interface TimeEntryFilter {
  /** Entries whose start is >= this instant. */
  from?: Date;
  /** Entries whose start is < this instant. */
  to?: Date;
  /** Entries changed at or after this instant, deleted ones included. */
  changedSince?: Date;
  projectIds?: Array<number | null>;
  limit?: number;
}

export function listTimeEntries(db: Db, userId: number, filter: TimeEntryFilter = {}): TimeEntryWithMeta[] {
  const where = ['te.user_id = ?'];
  const params: Array<string | number> = [userId];
  if (filter.changedSince) {
    where.push('te.updated_at >= ?');
    params.push(filter.changedSince.toISOString());
  } else {
    where.push('te.deleted_at IS NULL');
  }
  if (filter.from) {
    where.push('te.start >= ?');
    params.push(filter.from.toISOString());
  }
  if (filter.to) {
    where.push('te.start < ?');
    params.push(filter.to.toISOString());
  }
  if (filter.projectIds) {
    const ids = filter.projectIds.filter((id): id is number => id !== null);
    const clauses = [];
    if (ids.length) {
      clauses.push(`te.project_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (filter.projectIds.includes(null)) clauses.push('te.project_id IS NULL');
    where.push(clauses.length ? `(${clauses.join(' OR ')})` : '0');
  }
  const limit = filter.limit ? `LIMIT ${Math.floor(filter.limit)}` : '';
  return db.prepare(`${SELECT_WITH_META} WHERE ${where.join(' AND ')} ORDER BY te.start DESC, te.id DESC ${limit}`)
    .all(...params) as unknown as TimeEntryWithMeta[];
}

export function getTimeEntry(db: Db, userId: number, id: number, options: { includeDeleted?: boolean } = {}): TimeEntryWithMeta {
  const row = db.prepare(`${SELECT_WITH_META} WHERE te.user_id = ? AND te.id = ?`).get(userId, id) as TimeEntryWithMeta | undefined;
  if (!row || (row.deleted_at && !options.includeDeleted)) throw notFound('Time entry not found');
  return row;
}

export function getRunningEntry(db: Db, userId: number): TimeEntryWithMeta | undefined {
  return db.prepare(`${SELECT_WITH_META} WHERE te.user_id = ? AND te.stop IS NULL AND te.deleted_at IS NULL`)
    .get(userId) as TimeEntryWithMeta | undefined;
}

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
function snapToResolution(db: Db, user: UserRow, start: Date, stop: Date): SnappedSpan | null {
  return snapSpan(wholeSeconds(start), wholeSeconds(stop), getTimeResolutionMinutes(db), user.timezone);
}

function tooShort(db: Db): HttpError {
  return badRequest(`Time entry is too short: it rounds to zero at the ${getTimeResolutionMinutes(db)}-minute time resolution`);
}

function readTagIds(db: Db, wid: number, body: Record<string, unknown>): number[] | undefined {
  let ids: number[] | undefined;
  if (body.tag_ids !== undefined && body.tag_ids !== null) {
    if (!Array.isArray(body.tag_ids)) throw badRequest('Invalid tag_ids: expected an array');
    ids = body.tag_ids.map((value) => {
      const id = optionalId(value, 'tag_ids');
      if (!id) throw badRequest('Invalid tag_ids');
      return getTag(db, wid, id).id;
    });
  }
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      throw badRequest('Invalid tags: expected an array of strings');
    }
    ids = [...(ids ?? []), ...resolveTagNames(db, wid, body.tags as string[])];
  }
  return ids === undefined ? undefined : [...new Set(ids)];
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

function readStart(body: Record<string, unknown>, fallback: Date): Date {
  const value = body.start ?? fallback.toISOString();
  const start = parseInstant(value, 'start');
  if (body.start_date === undefined || body.start_date === null) return start;
  if (typeof body.start_date !== 'string' || !parseDateKey(body.start_date)) {
    throw badRequest('Invalid start_date: expected YYYY-MM-DD');
  }
  return parseInstant(`${body.start_date}${(value as string).slice(10)}`, 'start');
}

function assertConsistentDuration(start: Date, stop: Date | null, duration: number | undefined, body: Record<string, unknown>): void {
  if (body.stop != null && stop && duration !== undefined && seconds(stop) - seconds(start) !== duration) {
    throw badRequest('Stop and duration must be consistent with start');
  }
}

function resolveProjectAndTask(
  db: Db, wid: number, body: Record<string, unknown>, current: { projectId: number | null; taskId: number | null },
): { projectId: number | null; taskId: number | null; project: ProjectRef | null; projectChanged: boolean } {
  const projectInput = optionalId(body.project_id !== undefined ? body.project_id : body.pid, 'project_id');
  const taskInput = optionalId(body.task_id !== undefined ? body.task_id : body.tid, 'task_id');
  let projectId = projectInput === undefined ? current.projectId : projectInput;
  let taskId = taskInput === undefined ? current.taskId : taskInput;
  if (projectInput !== undefined && taskInput === undefined && projectInput !== current.projectId) taskId = null;

  if (taskId !== null) {
    const task = getTaskRef(db, wid, taskId);
    if (projectId === null) projectId = task.project_id;
    else if (task.project_id !== projectId) throw badRequest('Task does not belong to the project');
  }
  const project = projectId === null ? null : getProjectRef(db, wid, projectId);
  return { projectId, taskId, project, projectChanged: projectInput !== undefined && projectInput !== current.projectId };
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
function settleSpan(db: Db, user: UserRow, draft: Draft, { exact = false, unchanged = false } = {}): void {
  if (!draft.stop) return;
  if (seconds(draft.stop) < seconds(draft.start)) throw badRequest('Stop time must be after start time');
  if (!exact) {
    const snapped = snapToResolution(db, user, draft.start, draft.stop);
    if (snapped) Object.assign(draft, snapped);
    else if (!unchanged) throw tooShort(db);
  }
  if (seconds(draft.stop) - seconds(draft.start) > MAX_DURATION_SECONDS) {
    throw badRequest('Time entries can not be longer than 999 hours');
  }
}

/**
 * Stops a running entry at `at` (or at its start, if `at` is earlier) and snaps it like any other
 * stopped entry. A timer started at `at` later snaps its start to the same grid point, so a switch
 * from one timer to the next is stored back to back. Returns false when the span is too short to
 * keep: the entry then goes to the trash with zero length on its snapped start, so a client that
 * adds up stored durations, such as a pause chain, counts nothing for it, and undoing the delete
 * brings it back.
 *
 * A timer left running past the 999-hour cap stops at the cap instead of failing. A failed stop
 * would leave it running, and every new timer would fail too, because starting one stops it. 999
 * hours is a multiple of every resolution, so the clamped span stays on the grid.
 */
function stopEntryAt(db: Db, user: UserRow, entry: TimeEntryRow, at: Date): boolean {
  const start = new Date(entry.start);
  const snapped = snapToResolution(db, user, start, at < start ? start : at);
  const now = nowIso();
  if (!snapped) {
    const point = isoSeconds(snapInstant(wholeSeconds(start), getTimeResolutionMinutes(db), user.timezone));
    db.prepare('UPDATE time_entries SET start = ?, stop = ?, deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(point, point, now, now, entry.id);
    return false;
  }
  const stop = Math.min(snapped.stop.getTime(), snapped.start.getTime() + MAX_DURATION_SECONDS * 1000);
  db.prepare('UPDATE time_entries SET start = ?, stop = ?, updated_at = ? WHERE id = ?')
    .run(isoSeconds(snapped.start), isoSeconds(new Date(stop)), now, entry.id);
  return true;
}

/** Stops whatever is running so a new running entry can take its place. */
function stopRunning(db: Db, user: UserRow, at: Date, exceptId?: number): void {
  const running = getRunningEntry(db, user.id);
  if (!running || running.id === exceptId) return;
  stopEntryAt(db, user, running, at < new Date(running.start) ? new Date() : at);
}

function saveTags(db: Db, id: number, tagIds: number[]): void {
  db.prepare('DELETE FROM time_entry_tags WHERE time_entry_id = ?').run(id);
  const insert = db.prepare('INSERT INTO time_entry_tags (time_entry_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds) insert.run(id, tagId);
}

export function currentTagIds(row: TimeEntryWithMeta): number[] {
  return (JSON.parse(row.tags_json) as Array<{ id: number }>).map((tag) => tag.id);
}

export interface CreateOptions {
  /**
   * Keeps the exact start and stop instead of snapping them to the instance resolution. Only the
   * CSV import and the JSON restore set it, so imported history matches the file.
   */
  exact?: boolean;
}

export function createTimeEntry(
  db: Db, user: UserRow, wid: number, body: Record<string, unknown>, options: CreateOptions = {},
): TimeEntryWithMeta {
  return transaction(db, () => {
    touchTimer(db, user.id);
    assertWorkspace(body, wid);
    const start = readStart(body, new Date());
    const duration = readDuration(body.duration);
    let stop: Date | null = null;
    if (body.stop !== undefined && body.stop !== null) stop = parseInstant(body.stop, 'stop');
    else if (duration !== undefined && duration >= 0) stop = new Date(start.getTime() + duration * 1000);
    assertConsistentDuration(start, stop, duration, body);

    const { projectId, taskId, project } = resolveProjectAndTask(db, wid, body, { projectId: null, taskId: null });
    const billableInput = optionalBool(body.billable, 'billable');
    const projectBillable = project !== null && asBool(project.billable);
    const draft: Draft = {
      projectId,
      taskId,
      description: optionalString(body.description, 'description', MAX_DESCRIPTION_LENGTH) ?? '',
      start,
      stop,
      billable: billableInput ?? projectBillable,
      tagIds: readTagIds(db, wid, body) ?? [],
    };
    settleSpan(db, user, draft, { exact: options.exact === true });
    if (!draft.stop) stopRunning(db, user, draft.start);

    const now = nowIso();
    const createdWith = optionalString(body.created_with, 'created_with', 255) ?? 'api';
    const result = db.prepare(`
      INSERT INTO time_entries (workspace_id, user_id, project_id, task_id, description, start, stop, billable,
                                duronly, created_with, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(wid, user.id, draft.projectId, draft.taskId, draft.description, isoSeconds(draft.start),
      draft.stop ? isoSeconds(draft.stop) : null, Number(draft.billable), createdWith, now, now);
    const id = Number(result.lastInsertRowid);
    saveTags(db, id, draft.tagIds);
    return getTimeEntry(db, user.id, id);
  });
}

export function updateTimeEntry(
  db: Db, user: UserRow, wid: number, id: number, body: Record<string, unknown>,
): TimeEntryWithMeta {
  return transaction(db, () => {
    touchTimer(db, user.id);
    assertWorkspace(body, wid);
    const current = getTimeEntry(db, user.id, id);
    if (current.workspace_id !== wid) throw notFound('Time entry not found');

    const currentStart = new Date(current.start);
    const currentStop = current.stop ? new Date(current.stop) : null;
    const start = readStart(body, currentStart);
    const duration = readDuration(body.duration);
    let stop = currentStop;
    if (body.stop !== undefined && body.stop !== null) {
      stop = parseInstant(body.stop, 'stop');
    } else if (duration !== undefined) {
      stop = duration >= 0 ? new Date(start.getTime() + duration * 1000) : null;
    }
    assertConsistentDuration(start, stop, duration, body);
    // Editing only the start of a stopped entry keeps its stop time, as the Toggl web app does.

    const { projectId, taskId, project, projectChanged } = resolveProjectAndTask(db, wid, body, {
      projectId: current.project_id, taskId: current.task_id,
    });
    const billableInput = optionalBool(body.billable, 'billable');
    let billable = billableInput ?? asBool(current.billable);
    if (billableInput === undefined && projectChanged && project !== null) {
      billable = asBool(project.billable);
    }
    const draft: Draft = {
      projectId,
      taskId,
      description: optionalString(body.description, 'description', MAX_DESCRIPTION_LENGTH) ?? current.description,
      start,
      stop,
      billable,
      tagIds: applyTagAction(currentTagIds(current), readTagIds(db, wid, body), body.tag_action),
    };
    const unchanged = seconds(start) === seconds(currentStart) && stop?.getTime() === currentStop?.getTime();
    settleSpan(db, user, draft, { unchanged });
    if (!draft.stop && currentStop) stopRunning(db, user, new Date(), id);

    db.prepare(`
      UPDATE time_entries SET project_id = ?, task_id = ?, description = ?, start = ?, stop = ?, billable = ?,
        updated_at = ?
      WHERE id = ?
    `).run(draft.projectId, draft.taskId, draft.description, isoSeconds(draft.start),
      draft.stop ? isoSeconds(draft.stop) : null, Number(draft.billable), nowIso(), id);
    saveTags(db, id, draft.tagIds);
    return getTimeEntry(db, user.id, id);
  });
}

export function stopTimeEntry(db: Db, user: UserRow, wid: number, id: number, stop?: unknown): TimeEntryWithMeta {
  const at = stop === undefined ? new Date() : parseInstant(stop, 'stop');
  return transaction(db, () => {
    touchTimer(db, user.id);
    const current = getTimeEntry(db, user.id, id);
    if (current.workspace_id !== wid) throw notFound('Time entry not found');
    if (current.stop) throw conflict('Time entry already stopped');
    stopEntryAt(db, user, current, at);
    return getTimeEntry(db, user.id, id, { includeDeleted: true });
  });
}

export function deleteTimeEntry(db: Db, userId: number, wid: number, id: number): void {
  transaction(db, () => {
    touchTimer(db, userId);
    const current = getTimeEntry(db, userId, id);
    if (current.workspace_id !== wid) throw notFound('Time entry not found');
    const now = nowIso();
    db.prepare('UPDATE time_entries SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  });
}

/** Undoes a delete. A restored running entry is stopped if another one started meanwhile. */
/** Takes `user`'s entry out of the trash. Refused with 403 once the user has left the entry's workspace. */
export function restoreTimeEntry(db: Db, user: UserRow, id: number): TimeEntryWithMeta {
  return transaction(db, () => {
    touchTimer(db, user.id);
    const current = getTimeEntry(db, user.id, id, { includeDeleted: true });
    memberWorkspace(db, user.id, current.workspace_id);
    if (!current.deleted_at) return current;
    if (!current.stop && getRunningEntry(db, user.id) && !stopEntryAt(db, user, current, new Date())) {
      return getTimeEntry(db, user.id, id, { includeDeleted: true });
    }
    db.prepare('UPDATE time_entries SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
    return getTimeEntry(db, user.id, id);
  });
}

export function listDeletedEntries(db: Db, userId: number): TimeEntryWithMeta[] {
  return db.prepare(`${SELECT_WITH_META} WHERE te.user_id = ? AND te.deleted_at IS NOT NULL ORDER BY te.deleted_at DESC LIMIT 1000`)
    .all(userId) as unknown as TimeEntryWithMeta[];
}

/** Permanently removes deleted entries: one id, or all of them. Returns how many rows went. */
export function purgeDeletedEntries(db: Db, userId: number, id?: number): number {
  return transaction(db, () => {
    touchTimer(db, userId);
    const result = id === undefined
      ? db.prepare('DELETE FROM time_entries WHERE user_id = ? AND deleted_at IS NOT NULL').run(userId)
      : db.prepare('DELETE FROM time_entries WHERE user_id = ? AND id = ? AND deleted_at IS NOT NULL').run(userId, id);
    return Number(result.changes);
  });
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

/**
 * Applies JSON Patch style operations to several entries. Each entry succeeds or fails on its own,
 * matching Toggl's "partial execution, no rollback" behaviour: a savepoint per entry, inside one
 * transaction.
 */
export function patchTimeEntries(
  db: Db, user: UserRow, wid: number, ids: number[], operations: unknown,
): { success: number[]; failure: Array<{ id: number; message: string }> } {
  if (!Array.isArray(operations) || operations.length === 0) throw badRequest('Expected an array of patch operations');
  return transaction(db, () => {
    touchTimer(db, user.id);
    const success: number[] = [];
    const failure: Array<{ id: number; message: string }> = [];
    for (const id of ids) {
      db.exec('SAVEPOINT patch_entry');
      try {
        for (const raw of operations as PatchOperation[]) {
          if (!raw || typeof raw.op !== 'string' || typeof raw.path !== 'string') throw badRequest('Invalid patch operation');
          updateTimeEntry(db, user, wid, id, operationToBody(raw));
        }
        db.exec('RELEASE patch_entry');
        success.push(id);
      } catch (error) {
        db.exec('ROLLBACK TO patch_entry');
        db.exec('RELEASE patch_entry');
        failure.push({ id, message: error instanceof Error ? error.message : 'Failed' });
      }
    }
    return { success, failure };
  });
}

export function entryDurationSeconds(row: Pick<TimeEntryRow, 'start' | 'stop'>, now = new Date()): number {
  return seconds(row.stop ? new Date(row.stop) : now) - seconds(new Date(row.start));
}

export function serializeTimeEntry(row: TimeEntryWithMeta, options: { meta?: boolean; user?: UserRow } = {}) {
  const tags = JSON.parse(row.tags_json) as Array<{ id: number; name: string }>;
  const start = new Date(row.start);
  const duration = row.stop ? seconds(new Date(row.stop)) - seconds(start) : -seconds(start);
  const entry: Record<string, unknown> = {
    id: row.id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    task_id: row.task_id,
    billable: asBool(row.billable),
    start: togglTime(row.start),
    stop: togglTime(row.stop),
    duration,
    description: row.description,
    tags: tags.map((tag) => tag.name),
    tag_ids: tags.map((tag) => tag.id),
    duronly: true,
    at: togglTime(row.updated_at),
    server_deleted_at: togglTime(row.deleted_at),
    user_id: row.user_id,
    uid: row.user_id,
    wid: row.workspace_id,
    pid: row.project_id,
    tid: row.task_id,
    permissions: null,
    expense_ids: [],
  };
  if (options.meta) {
    Object.assign(entry, {
      project_name: row.project_name,
      project_color: row.project_color,
      project_active: row.project_active === null ? null : asBool(row.project_active),
      project_billable: row.project_billable === null ? null : asBool(row.project_billable),
      client_id: row.client_id,
      client_name: row.client_name,
      task_name: row.task_name,
      task_active: row.task_active === null ? null : asBool(row.task_active),
      user_name: options.user?.fullname ?? null,
      user_avatar_url: '',
    });
  }
  return entry;
}
