import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { asBool, optionalString, requireName, togglTime } from '../lib/values.ts';

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
  const current = getClient(db, wid, id);
  const name = body.name === undefined ? current.name : requireName(body.name, 'Client name', 255);
  const notes = body.notes === undefined ? current.notes : (optionalString(body.notes, 'notes', 10_000) ?? null);
  const archived = typeof body.archived === 'boolean' ? Number(body.archived) : current.archived;
  assertUniqueName(db, wid, name, id);
  db.prepare('UPDATE clients SET name = ?, notes = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(name, notes, archived, nowIso(), id);
  return getClient(db, wid, id);
}

/** Archiving a client archives its projects too, as Toggl does. Returns the affected project ids. */
export function setClientArchived(db: Db, wid: number, id: number, archived: boolean): number[] {
  getClient(db, wid, id);
  const now = nowIso();
  db.prepare('UPDATE clients SET archived = ?, updated_at = ? WHERE id = ?').run(Number(archived), now, id);
  const projects = db.prepare('SELECT id FROM projects WHERE client_id = ? AND active = ?')
    .all(id, archived ? 1 : 0) as Array<{ id: number }>;
  db.prepare('UPDATE projects SET active = ?, updated_at = ? WHERE client_id = ?').run(archived ? 0 : 1, now, id);
  return projects.map((p) => p.id);
}

export function deleteClient(db: Db, wid: number, id: number): void {
  getClient(db, wid, id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
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
