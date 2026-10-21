import {
  DEFAULT_POMODORO_SESSION_CONFIG, POMODORO_SESSION_CONFIG_RANGES, type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { generateApiToken, hashPassword } from '../auth/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { togglTime } from '../lib/values.ts';
import { MAX_DESCRIPTION_LENGTH } from './timeEntries.ts';
import { addWorkspaceMember, createWorkspace } from './workspaces.ts';

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
  role: UserRole;
  /** When an admin suspended the account; null while it is active. */
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'admin' | 'user';

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
  pomodoro_focus_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.workMinutes,
  pomodoro_break_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.shortRestMinutes,
  pomodoro_long_break_interval_in_minutes: DEFAULT_POMODORO_SESSION_CONFIG.longRestMinutes,
  pomodoro_long_break_every: DEFAULT_POMODORO_SESSION_CONFIG.longRestEvery,
  reminder_enabled: false,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
  keyboard_shortcuts_enabled: true,
  theme: 'system',
} as const;

export type Preferences = Record<string, unknown>;

export const MAX_FAVORITES = 9;

interface PreferenceRule {
  valid: (value: unknown) => boolean;
  expected: string;
}

const boolean: PreferenceRule = { valid: (value) => typeof value === 'boolean', expected: 'a boolean' };
// Formats are free text so clients can save custom patterns.
const format: PreferenceRule = {
  valid: (value) => typeof value === 'string' && value.trim() !== '' && value.length <= 255,
  expected: 'a non-empty string of at most 255 characters',
};
const oneOf = (...values: string[]): PreferenceRule => ({
  valid: (value) => typeof value === 'string' && values.includes(value),
  expected: `one of ${values.join(', ')}`,
});
/** Accepts a JSON integer from `min` to `max`, both included. Fractions, numeric strings, null and booleans fail. */
const integerFrom = (min: number, max: number): PreferenceRule => ({
  valid: (value) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  expected: `an integer from ${min} to ${max}`,
});

const pomodoroRange = (key: keyof PomodoroSessionConfig): PreferenceRule => {
  const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
  return integerFrom(min, max);
};

const isOptionalId = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) > 0);

function isFavorite(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const favorite = value as Record<string, unknown>;
  return typeof favorite.description === 'string' && favorite.description.length <= MAX_DESCRIPTION_LENGTH
    && isOptionalId(favorite.project_id) && isOptionalId(favorite.task_id)
    && Array.isArray(favorite.tags) && favorite.tags.every((tag) => typeof tag === 'string' && tag.length <= 255)
    && typeof favorite.billable === 'boolean';
}

/** Known preferences Tokkl's clients read, with the values they can use. Other keys are stored as sent. */
const PREFERENCE_RULES: Record<string, PreferenceRule> = {
  date_format: format,
  timeofday_format: format,
  duration_format: oneOf('improved', 'classic', 'decimal'),
  theme: oneOf('system', 'light', 'dark'),
  timerView: oneOf('list', 'calendar'),
  collapseTimeEntries: boolean,
  manualMode: boolean,
  keyboard_shortcuts_enabled: boolean,
  showTimeInTitle: boolean,
  pomodoro_focus_interval_in_minutes: pomodoroRange('workMinutes'),
  pomodoro_break_interval_in_minutes: pomodoroRange('shortRestMinutes'),
  pomodoro_long_break_interval_in_minutes: pomodoroRange('longRestMinutes'),
  pomodoro_long_break_every: pomodoroRange('longRestEvery'),
  long_timer_reminder_enabled: boolean,
  long_timer_reminder_hours: integerFrom(1, 168),
  favorites: {
    valid: (value) => Array.isArray(value) && value.length <= MAX_FAVORITES && value.every(isFavorite),
    expected: `a list of at most ${MAX_FAVORITES} favorites with description, project_id, task_id, tags and billable`,
  },
};

const isUsable = (key: string, value: unknown) => PREFERENCE_RULES[key]?.valid(value) ?? true;

/** Throws 400 for a known preference with a value the app cannot use. */
export function validatePreferenceChanges(changes: Preferences): void {
  for (const [key, value] of Object.entries(changes)) {
    if (!isUsable(key, value)) throw badRequest(`Invalid ${key}: expected ${PREFERENCE_RULES[key]!.expected}`);
  }
}

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

/** False once an admin has suspended the account. A suspended account cannot sign in by any method. */
export function isActiveUser(user: UserRow): boolean {
  return user.disabled_at === null;
}

export function isActiveAdmin(user: UserRow): boolean {
  return user.role === 'admin' && isActiveUser(user);
}

export function listUsers(db: Db): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY id').all() as unknown as UserRow[];
}

export function countActiveAdmins(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;
}

/** The account fields an instance admin sees. Never includes the API token, password hash or preferences. */
export function serializeAccount(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    fullname: user.fullname,
    role: user.role,
    created_at: togglTime(user.created_at),
    disabled_at: togglTime(user.disabled_at),
  };
}

/** What a new account needs, as checked by the setup and invite routes. */
export interface NewAccount {
  email: string;
  password: string;
  fullname: string;
  timezone: string;
}

/**
 * Inserts an account with a new private workspace it owns and makes that its default workspace.
 * Call it inside a transaction with a password hashed beforehand, so scrypt never holds the write lock.
 */
export function insertAccount(
  db: Db,
  input: Omit<NewAccount, 'password'> & { passwordHash: string; role: UserRole },
): UserRow {
  const now = nowIso();
  const workspace = createWorkspace(db, `${input.fullname || 'My'} workspace`.trim());
  const preferences = { ...DEFAULT_PREFERENCES, pg_time_zone_name: input.timezone };
  const result = db.prepare(`
    INSERT INTO users (email, fullname, password_hash, api_token, timezone, default_workspace_id,
                       preferences, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.email, input.fullname, input.passwordHash, generateApiToken(), input.timezone,
    workspace.id, JSON.stringify(preferences), input.role, now, now);
  const userId = Number(result.lastInsertRowid);
  addWorkspaceMember(db, workspace.id, userId, 'owner');
  return getUser(db, userId)!;
}

/** Creates the first admin and the workspace it owns in one transaction. Refuses once any user exists. */
export async function createFirstAdmin(db: Db, input: NewAccount): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  return transaction(db, () => {
    if (countUsers(db) > 0) throw new Error('An account already exists');
    return insertAccount(db, { ...input, passwordHash, role: 'admin' });
  });
}

export function getPreferences(user: UserRow): Preferences {
  // Values saved before validation existed fall back to the defaults instead of reaching clients.
  const stored = Object.entries(JSON.parse(user.preferences) as Preferences).filter(([key, value]) => isUsable(key, value));
  return { ...DEFAULT_PREFERENCES, ...Object.fromEntries(stored) };
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
