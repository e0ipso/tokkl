import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { PROJECT_COLORS, isHexColor } from '@tokkl/common/colors';
import { badRequest, notFound } from '../lib/errors.ts';
import {
  asBool, optionalBool, optionalId, optionalNumber, optionalRate, optionalString, requireName, togglTime,
} from '../lib/values.ts';
import { createClient, getClient } from './clients.ts';
import { touchWorkspaceTimers } from './timerState.ts';

export interface ProjectRow {
  id: number;
  workspace_id: number;
  client_id: number | null;
  name: string;
  color: string;
  active: number;
  is_private: number;
  billable: number;
  estimated_hours: number | null;
  rate: number | null;
  currency: string | null;
  fixed_fee: number | null;
  start_date: string | null;
  end_date: string | null;
  template: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends ProjectRow {
  client_name: string | null;
  actual_seconds: number;
}

const SELECT_WITH_STATS = `
  SELECT p.*, c.name AS client_name,
    COALESCE((
      SELECT SUM(CASE WHEN te.stop IS NULL
        THEN unixepoch('now') - unixepoch(te.start)
        ELSE unixepoch(te.stop) - unixepoch(te.start) END)
      FROM time_entries te WHERE te.project_id = p.id AND te.deleted_at IS NULL
    ), 0) AS actual_seconds
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id
`;

export interface ProjectFilter {
  active?: boolean | 'both';
  name?: string;
  clientIds?: number[];
  billable?: boolean;
  sinceIso?: string;
}

export function listProjects(db: Db, wid: number, filter: ProjectFilter = {}): ProjectWithStats[] {
  const where = ['p.workspace_id = ?'];
  const params: Array<string | number> = [wid];
  if (filter.active === true) where.push('p.active = 1');
  if (filter.active === false) where.push('p.active = 0');
  if (filter.billable !== undefined) {
    where.push('p.billable = ?');
    params.push(Number(filter.billable));
  }
  if (filter.name) {
    where.push('instr(lower(p.name), lower(?)) > 0');
    params.push(filter.name);
  }
  if (filter.clientIds?.length) {
    where.push(`p.client_id IN (${filter.clientIds.map(() => '?').join(',')})`);
    params.push(...filter.clientIds);
  }
  if (filter.sinceIso) {
    where.push('p.updated_at >= ?');
    params.push(filter.sinceIso);
  }
  return db.prepare(`${SELECT_WITH_STATS} WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE`)
    .all(...params) as unknown as ProjectWithStats[];
}

export function getProject(db: Db, wid: number, id: number): ProjectWithStats {
  const row = db.prepare(`${SELECT_WITH_STATS} WHERE p.workspace_id = ? AND p.id = ?`).get(wid, id) as ProjectWithStats | undefined;
  if (!row) throw notFound('Project not found');
  return row;
}

/** The columns write validation needs, without the tracked-time aggregate. */
export type ProjectRef = Pick<ProjectRow, 'id' | 'workspace_id' | 'active' | 'billable'>;

/** Checks that a project exists in the workspace. Use getProject when the response needs totals. */
export function getProjectRef(db: Db, wid: number, id: number): ProjectRef {
  const row = db.prepare('SELECT id, workspace_id, active, billable FROM projects WHERE workspace_id = ? AND id = ?')
    .get(wid, id) as ProjectRef | undefined;
  if (!row) throw notFound('Project not found');
  return row;
}

function assertUniqueName(db: Db, wid: number, clientId: number | null, name: string, exceptId?: number): void {
  const existing = db.prepare(`
    SELECT id FROM projects WHERE workspace_id = ? AND IFNULL(client_id, 0) = ? AND name = ? COLLATE NOCASE
  `).get(wid, clientId ?? 0, name) as { id: number } | undefined;
  if (existing && existing.id !== exceptId) throw badRequest('Name has already been taken');
}

function resolveClientId(db: Db, wid: number, body: Record<string, unknown>, fallback: number | null): number | null {
  // `client_id: null` clears the client, so only fall back to the legacy `cid` when the key is absent.
  const id = optionalId('client_id' in body ? body.client_id : body.cid, 'client_id');
  if (id === undefined) {
    const clientName = optionalString(body.client_name, 'client_name', 255);
    if (!clientName) return fallback;
    const existing = db.prepare('SELECT id FROM clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE')
      .get(wid, clientName.trim()) as { id: number } | undefined;
    return existing?.id ?? createClient(db, wid, { name: clientName }).id;
  }
  if (id !== null) getClient(db, wid, id);
  return id;
}

function parseColor(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !isHexColor(value)) throw badRequest('Invalid color: expected #rrggbb');
  return value.toLowerCase();
}

function parseDate(value: unknown, field: string, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`Invalid ${field}: expected YYYY-MM-DD`);
  return value;
}

function parseCurrency(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) throw badRequest('Invalid currency: expected an ISO 4217 code');
  return value.toUpperCase();
}

function nextColor(db: Db, wid: number): string {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?').get(wid) as { n: number };
  return PROJECT_COLORS[n % PROJECT_COLORS.length]!;
}

export function createProject(db: Db, wid: number, body: Record<string, unknown>): ProjectWithStats {
  const name = requireName(body.name, 'Project name', 255);
  const clientId = resolveClientId(db, wid, body, null);
  assertUniqueName(db, wid, clientId, name);
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO projects (workspace_id, client_id, name, color, active, is_private, billable, estimated_hours,
                          rate, currency, fixed_fee, start_date, end_date, template, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wid, clientId, name, parseColor(body.color, nextColor(db, wid)),
    Number(optionalBool(body.active, 'active') ?? true),
    Number(optionalBool(body.is_private, 'is_private') ?? true),
    Number(optionalBool(body.billable, 'billable') ?? false),
    optionalNumber(body.estimated_hours, 'estimated_hours') ?? null,
    optionalRate(body.rate, 'rate') ?? null,
    parseCurrency(body.currency, null),
    optionalNumber(body.fixed_fee, 'fixed_fee') ?? null,
    parseDate(body.start_date, 'start_date', null),
    parseDate(body.end_date, 'end_date', null),
    Number(optionalBool(body.template, 'template') ?? false),
    now, now,
  );
  return getProject(db, wid, Number(result.lastInsertRowid));
}

export function updateProject(db: Db, wid: number, id: number, body: Record<string, unknown>): ProjectWithStats {
  return transaction(db, () => {
    const current = getProject(db, wid, id);
    const name = body.name === undefined ? current.name : requireName(body.name, 'Project name', 255);
    const clientId = resolveClientId(db, wid, body, current.client_id);
    assertUniqueName(db, wid, clientId, name, id);
    const pick = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
    touchWorkspaceTimers(db, wid);
    db.prepare(`
      UPDATE projects SET client_id = ?, name = ?, color = ?, active = ?, is_private = ?, billable = ?,
        estimated_hours = ?, rate = ?, currency = ?, fixed_fee = ?, start_date = ?, end_date = ?, template = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      clientId, name, parseColor(body.color, current.color),
      Number(pick(optionalBool(body.active, 'active'), asBool(current.active))),
      Number(pick(optionalBool(body.is_private, 'is_private'), asBool(current.is_private))),
      Number(pick(optionalBool(body.billable, 'billable'), asBool(current.billable))),
      pick(optionalNumber(body.estimated_hours, 'estimated_hours'), current.estimated_hours),
      pick(optionalRate(body.rate, 'rate'), current.rate),
      parseCurrency(body.currency, current.currency),
      pick(optionalNumber(body.fixed_fee, 'fixed_fee'), current.fixed_fee),
      parseDate(body.start_date, 'start_date', current.start_date),
      parseDate(body.end_date, 'end_date', current.end_date),
      Number(pick(optionalBool(body.template, 'template'), asBool(current.template))),
      nowIso(), id,
    );
    return getProject(db, wid, id);
  });
}

/**
 * Deletes a project. Its time entries are kept without a project unless `deleteEntries` is set.
 * Either way its running entries change, other members' included.
 */
export function deleteProject(db: Db, wid: number, id: number, deleteEntries: boolean): void {
  transaction(db, () => {
    getProject(db, wid, id);
    touchWorkspaceTimers(db, wid);
    const now = nowIso();
    if (deleteEntries) {
      db.prepare('UPDATE time_entries SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL').run(now, now, id);
    } else {
      db.prepare('UPDATE time_entries SET updated_at = ? WHERE project_id = ?').run(now, id);
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });
}

function projectStatus(row: ProjectRow): string {
  if (!asBool(row.active)) return 'archived';
  const today = new Date().toISOString().slice(0, 10);
  if (row.start_date && row.start_date > today) return 'upcoming';
  if (row.end_date && row.end_date < today) return 'ended';
  return 'active';
}

export function serializeProject(row: ProjectWithStats, defaultCurrency: string) {
  const actualSeconds = Number(row.actual_seconds);
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    client_id: row.client_id,
    name: row.name,
    is_private: asBool(row.is_private),
    active: asBool(row.active),
    at: togglTime(row.updated_at),
    created_at: togglTime(row.created_at),
    server_deleted_at: null,
    color: row.color,
    billable: asBool(row.billable),
    template: asBool(row.template),
    auto_estimates: false,
    estimated_hours: row.estimated_hours,
    estimated_seconds: row.estimated_hours === null ? null : Math.round(row.estimated_hours * 3600),
    rate: row.rate,
    rate_last_updated: null,
    currency: row.currency,
    recurring: false,
    template_id: null,
    recurring_parameters: null,
    fixed_fee: row.fixed_fee,
    actual_hours: Math.floor(actualSeconds / 3600),
    actual_seconds: actualSeconds,
    start_date: row.start_date ?? row.created_at.slice(0, 10),
    end_date: row.end_date,
    status: projectStatus(row),
    wid: row.workspace_id,
    cid: row.client_id,
    client_name: row.client_name,
    can_track_time: true,
    pinned: false,
    permissions: null,
    workspace_default_currency: defaultCurrency,
    integration_provider: null,
    external_reference: null,
  };
}
