import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { generateApiToken, hashPassword } from '../auth/crypto.ts';
import { togglTime } from '../lib/values.ts';
import { createWorkspace } from './workspaces.ts';

export interface UserRow {
  id: number;
  email: string;
  fullname: string;
  password_hash: string;
  api_token: string;
  timezone: string;
  beginning_of_week: number;
  default_workspace_id: number;
  preferences: string;
  created_at: string;
  updated_at: string;
}

/** Defaults for the preferences this app reads. Unknown keys sent by clients are kept as-is. */
export const DEFAULT_PREFERENCES = {
  date_format: 'YYYY-MM-DD',
  timeofday_format: 'H:mm',
  duration_format: 'improved',
  collapseTimeEntries: true,
  manualMode: false,
  pg_time_zone_name: 'UTC',
  record_timeline: false,
  send_product_emails: false,
  send_timer_notifications: false,
  send_weekly_report: false,
  idle_detection_enabled: false,
  pomodoro_enabled: false,
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  reminder_enabled: false,
  keyboard_shortcuts_enabled: true,
  theme: 'system',
} as const;

export type Preferences = Record<string, unknown>;

export function countUsers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function getUser(db: Db, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function findUserByApiToken(db: Db, token: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE api_token = ?').get(token) as UserRow | undefined;
}

export async function createOwner(
  db: Db,
  input: { email: string; password: string; fullname: string; timezone: string },
): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  return transaction(db, () => {
    if (countUsers(db) > 0) throw new Error('An account already exists');
    const now = nowIso();
    const workspace = createWorkspace(db, `${input.fullname || 'My'} workspace`.trim());
    const preferences = { ...DEFAULT_PREFERENCES, pg_time_zone_name: input.timezone };
    const result = db.prepare(`
      INSERT INTO users (email, fullname, password_hash, api_token, timezone, default_workspace_id,
                         preferences, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.email, input.fullname, passwordHash, generateApiToken(), input.timezone,
      workspace.id, JSON.stringify(preferences), now, now);
    return getUser(db, Number(result.lastInsertRowid))!;
  });
}

export function getPreferences(user: UserRow): Preferences {
  return { ...DEFAULT_PREFERENCES, ...(JSON.parse(user.preferences) as Preferences) };
}

export function serializeUser(user: UserRow, options: { includeToken: boolean }) {
  return {
    id: user.id,
    api_token: options.includeToken ? user.api_token : undefined,
    email: user.email,
    fullname: user.fullname,
    timezone: user.timezone,
    toggl_accounts_id: String(user.id),
    default_workspace_id: user.default_workspace_id,
    beginning_of_week: user.beginning_of_week,
    image_url: '',
    created_at: togglTime(user.created_at),
    updated_at: togglTime(user.updated_at),
    openid_email: null,
    openid_enabled: false,
    country_id: null,
    has_password: true,
    at: togglTime(user.updated_at),
    intercom_hash: undefined,
    oauth_providers: [],
    '2fa_enabled': false,
    authorization_updated_at: togglTime(user.updated_at),
  };
}
