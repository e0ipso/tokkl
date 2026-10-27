import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { requireName, togglTime } from '../lib/values.ts';
import { touchWorkspaceTimers } from './timerState.ts';

export interface TagRow {
  id: number;
  workspace_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export function listTags(db: Db, wid: number, search?: string): TagRow[] {
  if (search) {
    return db.prepare('SELECT * FROM tags WHERE workspace_id = ? AND instr(lower(name), lower(?)) > 0 ORDER BY name COLLATE NOCASE')
      .all(wid, search) as unknown as TagRow[];
  }
  return db.prepare('SELECT * FROM tags WHERE workspace_id = ? ORDER BY name COLLATE NOCASE').all(wid) as unknown as TagRow[];
}

export function getTag(db: Db, wid: number, id: number): TagRow {
  const row = db.prepare('SELECT * FROM tags WHERE workspace_id = ? AND id = ?').get(wid, id) as TagRow | undefined;
  if (!row) throw notFound('Tag not found');
  return row;
}

function findByName(db: Db, wid: number, name: string): TagRow | undefined {
  return db.prepare('SELECT * FROM tags WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(wid, name) as TagRow | undefined;
}

export function createTag(db: Db, wid: number, body: Record<string, unknown>): TagRow {
  const name = requireName(body.name, 'Tag name', 255);
  if (findByName(db, wid, name)) throw badRequest('A tag with the same name already exists');
  const now = nowIso();
  const result = db.prepare('INSERT INTO tags (workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(wid, name, now, now);
  return getTag(db, wid, Number(result.lastInsertRowid));
}

/** Returns tag ids for names, creating missing tags (Toggl creates unknown tag names on the fly). */
export function resolveTagNames(db: Db, wid: number, names: string[]): number[] {
  const ids: number[] = [];
  for (const raw of names) {
    const name = requireName(raw, 'Tag name', 255);
    ids.push((findByName(db, wid, name) ?? createTag(db, wid, { name })).id);
  }
  return ids;
}

export function updateTag(db: Db, wid: number, id: number, body: Record<string, unknown>): TagRow {
  getTag(db, wid, id);
  const name = requireName(body.name, 'Tag name', 255);
  const existing = findByName(db, wid, name);
  if (existing && existing.id !== id) throw badRequest('A tag with the same name already exists');
  db.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), id);
  return getTag(db, wid, id);
}

/** Deletes a tag. The entries that carry it lose it, running ones included. */
export function deleteTag(db: Db, wid: number, id: number): void {
  transaction(db, () => {
    getTag(db, wid, id);
    touchWorkspaceTimers(db, wid);
    const now = nowIso();
    db.prepare(`
      UPDATE time_entries SET updated_at = ?
      WHERE id IN (SELECT time_entry_id FROM time_entry_tags WHERE tag_id = ?)
    `).run(now, id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  });
}

export function serializeTag(row: TagRow) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    at: togglTime(row.updated_at),
    deleted_at: null,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}
