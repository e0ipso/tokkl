import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { asBool, optionalBool, optionalNumber, requireName, togglTime } from '../lib/values.ts';
import { getProjectRef } from './projects.ts';
import { touchWorkspaceTimers } from './timerState.ts';

export interface TaskRow {
  id: number;
  workspace_id: number;
  project_id: number;
  name: string;
  active: number;
  estimated_seconds: number | null;
  created_at: string;
  updated_at: string;
}

interface TaskWithMeta extends TaskRow {
  project_name: string;
  project_color: string;
  project_billable: number;
  project_is_private: number;
  client_id: number | null;
  client_name: string | null;
  tracked_seconds: number;
}

const SELECT_WITH_META = `
  SELECT t.*, p.name AS project_name, p.color AS project_color, p.billable AS project_billable,
    p.is_private AS project_is_private, p.client_id, c.name AS client_name,
    COALESCE((
      SELECT SUM(unixepoch(COALESCE(te.stop, 'now')) - unixepoch(te.start))
      FROM time_entries te WHERE te.task_id = t.id AND te.deleted_at IS NULL
    ), 0) AS tracked_seconds
  FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = p.client_id
`;

export function listTasks(db: Db, wid: number, projectId?: number, active?: boolean): TaskWithMeta[] {
  const where = ['t.workspace_id = ?'];
  const params: number[] = [wid];
  if (projectId !== undefined) {
    where.push('t.project_id = ?');
    params.push(projectId);
  }
  if (active !== undefined) {
    where.push('t.active = ?');
    params.push(Number(active));
  }
  return db.prepare(`${SELECT_WITH_META} WHERE ${where.join(' AND ')} ORDER BY t.name COLLATE NOCASE`)
    .all(...params) as unknown as TaskWithMeta[];
}

export function getTask(db: Db, wid: number, id: number, projectId?: number): TaskWithMeta {
  const row = db.prepare(`${SELECT_WITH_META} WHERE t.workspace_id = ? AND t.id = ?`).get(wid, id) as TaskWithMeta | undefined;
  if (!row || (projectId !== undefined && row.project_id !== projectId)) throw notFound('Task not found');
  return row;
}

/** The columns write validation needs, without the tracked-time aggregate. */
export type TaskRef = Pick<TaskRow, 'id' | 'workspace_id' | 'project_id' | 'active'>;

/** Checks that a task exists in the workspace. Use getTask when the response needs totals. */
export function getTaskRef(db: Db, wid: number, id: number): TaskRef {
  const row = db.prepare('SELECT id, workspace_id, project_id, active FROM tasks WHERE workspace_id = ? AND id = ?')
    .get(wid, id) as TaskRef | undefined;
  if (!row) throw notFound('Task not found');
  return row;
}

function assertUniqueName(db: Db, projectId: number, name: string, exceptId?: number): void {
  const existing = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND name = ? COLLATE NOCASE')
    .get(projectId, name) as { id: number } | undefined;
  if (existing && existing.id !== exceptId) throw badRequest('Name has already been taken');
}

export function createTask(db: Db, wid: number, projectId: number, body: Record<string, unknown>): TaskWithMeta {
  const project = getProjectRef(db, wid, projectId);
  if (!asBool(project.active)) throw badRequest('Can not change tasks of archived project');
  const name = requireName(body.name, 'Task name', 255);
  assertUniqueName(db, projectId, name);
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO tasks (workspace_id, project_id, name, active, estimated_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(wid, projectId, name, Number(optionalBool(body.active, 'active') ?? true),
    optionalNumber(body.estimated_seconds, 'estimated_seconds') ?? null, now, now);
  return getTask(db, wid, Number(result.lastInsertRowid));
}

export function updateTask(db: Db, wid: number, projectId: number, id: number, body: Record<string, unknown>): TaskWithMeta {
  return transaction(db, () => {
    const current = getTask(db, wid, id, projectId);
    const name = body.name === undefined ? current.name : requireName(body.name, 'Task name', 255);
    assertUniqueName(db, projectId, name, id);
    const active = optionalBool(body.active, 'active');
    const estimate = optionalNumber(body.estimated_seconds, 'estimated_seconds');
    touchWorkspaceTimers(db, wid);
    db.prepare('UPDATE tasks SET name = ?, active = ?, estimated_seconds = ?, updated_at = ? WHERE id = ?').run(
      name, active === undefined ? current.active : Number(active),
      estimate === undefined ? current.estimated_seconds : estimate, nowIso(), id,
    );
    return getTask(db, wid, id);
  });
}

/** Deletes a task. Its entries are kept without it, running ones included. */
export function deleteTask(db: Db, wid: number, projectId: number, id: number): void {
  transaction(db, () => {
    getTask(db, wid, id, projectId);
    touchWorkspaceTimers(db, wid);
    db.prepare('UPDATE time_entries SET updated_at = ? WHERE task_id = ?').run(nowIso(), id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });
}

export function serializeTask(row: TaskWithMeta) {
  return {
    id: row.id,
    name: row.name,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    user_id: null,
    active: asBool(row.active),
    at: togglTime(row.updated_at),
    estimated_seconds: row.estimated_seconds,
    // Toggl documents this field as milliseconds despite the name.
    tracked_seconds: Number(row.tracked_seconds) * 1000,
    server_deleted_at: null,
    project_name: row.project_name,
    project_color: row.project_color,
    project_billable: asBool(row.project_billable),
    project_is_private: asBool(row.project_is_private),
    client_id: row.client_id,
    client_name: row.client_name,
    rate: null,
    recurring: false,
    permissions: null,
    integration_provider: null,
  };
}
