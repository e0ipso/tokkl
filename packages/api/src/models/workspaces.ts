import type { Db } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { togglTime } from '../lib/values.ts';

export interface WorkspaceRow {
  id: number;
  name: string;
  default_currency: string;
  default_hourly_rate: number | null;
  rounding: number;
  rounding_minutes: number;
  created_at: string;
  updated_at: string;
}

export function createWorkspace(db: Db, name: string): WorkspaceRow {
  const now = nowIso();
  const result = db.prepare(
    'INSERT INTO workspaces (name, created_at, updated_at) VALUES (?, ?, ?)',
  ).run(name, now, now);
  return getWorkspace(db, Number(result.lastInsertRowid))!;
}

export function getWorkspace(db: Db, id: number): WorkspaceRow | undefined {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
}

export function listWorkspaces(db: Db): WorkspaceRow[] {
  return db.prepare('SELECT * FROM workspaces ORDER BY id').all() as unknown as WorkspaceRow[];
}

export type WorkspaceMemberRole = 'owner' | 'member';

export function addWorkspaceMember(db: Db, wid: number, userId: number, role: WorkspaceMemberRole): void {
  db.prepare('INSERT INTO workspace_users (workspace_id, user_id, role) VALUES (?, ?, ?)').run(wid, userId, role);
}

export function isWorkspaceMember(db: Db, userId: number, wid: number): boolean {
  return db.prepare('SELECT 1 FROM workspace_users WHERE user_id = ? AND workspace_id = ?').get(userId, wid) !== undefined;
}

/** The workspaces `userId` belongs to, in any role, ordered by id. */
export function listWorkspacesForUser(db: Db, userId: number): WorkspaceRow[] {
  return db.prepare(`
    SELECT workspaces.* FROM workspaces
    JOIN workspace_users ON workspace_users.workspace_id = workspaces.id
    WHERE workspace_users.user_id = ?
    ORDER BY workspaces.id
  `).all(userId) as unknown as WorkspaceRow[];
}

export function serializeWorkspace(ws: WorkspaceRow) {
  return {
    id: ws.id,
    organization_id: ws.id,
    name: ws.name,
    premium: true,
    business_ws: true,
    admin: true,
    role: 'admin',
    suspended_at: null,
    server_deleted_at: null,
    default_hourly_rate: ws.default_hourly_rate,
    rate_last_updated: null,
    default_currency: ws.default_currency,
    only_admins_may_create_projects: false,
    only_admins_may_create_tags: false,
    only_admins_see_team_dashboard: false,
    projects_billable_by_default: false,
    projects_private_by_default: true,
    projects_enforce_billable: false,
    limit_public_project_data: false,
    last_modified: togglTime(ws.updated_at),
    reports_collapse: true,
    rounding: ws.rounding,
    rounding_minutes: ws.rounding_minutes,
    api_token: undefined,
    at: togglTime(ws.updated_at),
    logo_url: '',
    ical_url: '',
    ical_enabled: false,
    csv_upload: null,
    subscription: null,
    hide_start_end_times: false,
    disable_timesheet_view: false,
    disable_approvals: true,
    disable_expenses: true,
    working_hours_in_minutes: null,
    permissions: null,
    max_data_retention_days: null,
    te_constraints: null,
  };
}
