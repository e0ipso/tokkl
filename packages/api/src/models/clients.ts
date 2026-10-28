import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { asBool, optionalBool, optionalString, requireName, togglTime } from '../lib/values.ts';
import { touchWorkspaceTimers } from './timerState.ts';

export interface ClientRow {
  id: number;
  workspace_id: number;
  name: string;
  notes: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export function listClients(db: Db, wid: number, status: 'active' | 'archived' | 'both' = 'both', name?: string): ClientRow[] {
  const where = ['workspace_id = ?'];
  const params: Array<string | number> = [wid];
  if (status === 'active') where.push('archived = 0');
  if (status === 'archived') where.push('archived = 1');
  if (name) {
    where.push("instr(lower(name), lower(?)) > 0");
    params.push(name);
  }
  return db.prepare(`SELECT * FROM clients WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`)
    .all(...params) as unknown as ClientRow[];
}

export function getClient(db: Db, wid: number, id: number): ClientRow {
  const row = db.prepare('SELECT * FROM clients WHERE workspace_id = ? AND id = ?').get(wid, id) as ClientRow | undefined;
  if (!row) throw notFound(`No client with ID ${id} was found`);
  return row;
}

function assertUniqueName(db: Db, wid: number, name: string, exceptId?: number): void {
  const existing = db.prepare('SELECT id FROM clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE')
    .get(wid, name) as { id: number } | undefined;
  if (existing && existing.id !== exceptId) throw badRequest('Name has already been taken');
}

export function createClient(db: Db, wid: number, body: Record<string, unknown>): ClientRow {
  const name = requireName(body.name, 'Client name', 255);
  const notes = optionalString(body.notes, 'notes', 10_000) ?? null;
  assertUniqueName(db, wid, name);
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO clients (workspace_id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(wid, name, notes, now, now);
  return getClient(db, wid, Number(result.lastInsertRowid));
}

export function updateClient(db: Db, wid: number, id: number, body: Record<string, unknown>): ClientRow {
  return transaction(db, () => {
    const current = getClient(db, wid, id);
    const name = body.name === undefined ? current.name : requireName(body.name, 'Client name', 255);
    const notes = body.notes === undefined ? current.notes : (optionalString(body.notes, 'notes', 10_000) ?? null);
    const archived = typeof body.archived === 'boolean' ? Number(body.archived) : current.archived;
    assertUniqueName(db, wid, name, id);
    touchWorkspaceTimers(db, wid);
    db.prepare('UPDATE clients SET name = ?, notes = ?, archived = ?, updated_at = ? WHERE id = ?')
      .run(name, notes, archived, nowIso(), id);
    return getClient(db, wid, id);
  });
}

/** Archiving a client archives its projects too, as Toggl does. Returns the affected project ids. */
export function setClientArchived(db: Db, wid: number, id: number, archived: boolean): number[] {
  return transaction(db, () => {
    getClient(db, wid, id);
    touchWorkspaceTimers(db, wid);
    const now = nowIso();
    db.prepare('UPDATE clients SET archived = ?, updated_at = ? WHERE id = ?').run(Number(archived), now, id);
    const projects = db.prepare('SELECT id FROM projects WHERE client_id = ? AND active = ?')
      .all(id, archived ? 1 : 0) as Array<{ id: number }>;
    db.prepare('UPDATE projects SET active = ?, updated_at = ? WHERE client_id = ?').run(archived ? 0 : 1, now, id);
    return projects.map((p) => p.id);
  });
}

/** Restores only the projects requested by the caller, or every project when explicitly asked. */
export function restoreClient(db: Db, wid: number, id: number, body: Record<string, unknown>): ClientRow {
  return transaction(db, () => {
    getClient(db, wid, id);
    const all = optionalBool(body.restore_all_projects, 'restore_all_projects') ?? false;
    const projects = body.projects ?? [];
    if (!Array.isArray(projects) || projects.length > 1000
      || projects.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw badRequest('Invalid projects');
    const belongs = db.prepare('SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND client_id = ?');
    for (const pid of projects) {
      if (!belongs.get(pid, wid, id)) throw badRequest('Project does not belong to the client');
    }
    touchWorkspaceTimers(db, wid);
    const now = nowIso();
    db.prepare('UPDATE clients SET archived = 0, updated_at = ? WHERE id = ?').run(now, id);
    if (all) {
      db.prepare('UPDATE projects SET active = 1, updated_at = ? WHERE workspace_id = ? AND client_id = ?').run(now, wid, id);
    } else {
      const restore = db.prepare('UPDATE projects SET active = 1, updated_at = ? WHERE id = ?');
      for (const pid of projects) restore.run(now, pid);
    }
    return getClient(db, wid, id);
  });
}

const PROJECT_NAME_MAX = 255;
const CLIENT_LABEL_MAX = 100;

/** Cuts `value` to at most `max` UTF-16 units without splitting a surrogate pair. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1] ?? '') ? max - 1 : max;
  return value.slice(0, end);
}

/** `Website (ACME)`, then `Website (ACME) 2`, `Website (ACME) 3`, ... kept within the project name limit. */
function disambiguatedName(name: string, clientName: string, attempt: number): string {
  const tail = ` (${clip(clientName, CLIENT_LABEL_MAX)})${attempt > 1 ? ` ${attempt}` : ''}`;
  return clip(name, PROJECT_NAME_MAX - tail.length) + tail;
}

/**
 * Deletes a client and keeps its projects without a client. A project whose name is already
 * used by a project without a client gets the former client's name appended, plus a number if
 * that is taken too. Projects keep their IDs, entries and rates; they are never merged.
 */
export function deleteClient(db: Db, wid: number, id: number): void {
  transaction(db, () => {
    const client = getClient(db, wid, id);
    touchWorkspaceTimers(db, wid);
    const projects = db.prepare('SELECT id, name FROM projects WHERE client_id = ? ORDER BY id')
      .all(id) as Array<{ id: number; name: string }>;
    const nameTaken = db.prepare(`
      SELECT 1 FROM projects WHERE workspace_id = ? AND client_id IS NULL AND name = ? COLLATE NOCASE
    `);
    const colliding = projects.filter((p) => nameTaken.get(wid, p.name) !== undefined);
    const now = nowIso();
    const detach = db.prepare('UPDATE projects SET client_id = NULL, name = ?, updated_at = ? WHERE id = ?');
    // Projects with free names move first, so a generated name never displaces an original one.
    for (const project of projects) {
      if (!colliding.includes(project)) detach.run(project.name, now, project.id);
    }
    for (const project of colliding) {
      let attempt = 1;
      let name = disambiguatedName(project.name, client.name, attempt);
      while (nameTaken.get(wid, name) !== undefined) name = disambiguatedName(project.name, client.name, ++attempt);
      detach.run(name, now, project.id);
    }
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  });
}

export function serializeClient(row: ClientRow) {
  return {
    id: row.id,
    wid: row.workspace_id,
    archived: asBool(row.archived),
    name: row.name,
    at: togglTime(row.updated_at),
    notes: row.notes,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}
