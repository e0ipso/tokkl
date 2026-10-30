import { DEFAULT_POMODORO_SESSION_CONFIG, POMODORO_SESSION_CONFIG_RANGES, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import { canonicalTimeZone } from '@tokkl/common/time';
import { readNewPassword } from '../auth/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { togglTime, optionalString, optionalId } from '../lib/values.ts';
import type { JsonObject, User, Workspace, MembershipRole, AccountToken } from '../storage/domain.ts';
import type { AccountChanges } from '../storage/contracts.ts';
const MAX_ACCOUNT_FAVORITE_DESCRIPTION_LENGTH = 3000;
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

export type Preferences = JsonObject;

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
  return typeof favorite.description === 'string' && favorite.description.length <= MAX_ACCOUNT_FAVORITE_DESCRIPTION_LENGTH
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

export function getPreferences(user: User): Preferences {
  // Values saved before validation existed fall back to the defaults instead of reaching clients.
  const stored = Object.entries(user.preferences).filter(([key, value]) => isUsable(key, value));
  return { ...DEFAULT_PREFERENCES, ...Object.fromEntries(stored) };
}

export function getPomodoroSessionConfig(user: User): PomodoroSessionConfig {
  const preferences = getPreferences(user);
  return { workMinutes: preferences.pomodoro_focus_interval_in_minutes as number,
    shortRestMinutes: preferences.pomodoro_break_interval_in_minutes as number,
    longRestMinutes: preferences.pomodoro_long_break_interval_in_minutes as number,
    longRestEvery: preferences.pomodoro_long_break_every as number };
}

export function serializeAccount(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullname: user.fullName,
    role: user.role,
    created_at: togglTime(user.createdAt),
    disabled_at: togglTime(user.disabledAt),
  };
}

export function serializeUser(user: User, options: { includeToken: boolean }) {
  return {
    id: user.id,
    api_token: options.includeToken ? user.apiToken : undefined,
    email: user.email,
    fullname: user.fullName,
    timezone: user.timezone,
    toggl_accounts_id: String(user.id),
    default_workspace_id: user.defaultWorkspaceId,
    beginning_of_week: user.beginningOfWeek,
    image_url: '',
    created_at: togglTime(user.createdAt),
    updated_at: togglTime(user.updatedAt),
    openid_email: null,
    openid_enabled: false,
    country_id: null,
    has_password: true,
    at: togglTime(user.updatedAt),
    intercom_hash: undefined,
    oauth_providers: [],
    '2fa_enabled': false,
    authorization_updated_at: togglTime(user.updatedAt),
  };
}
export function serializeWorkspace(ws: Workspace, membership: MembershipRole | undefined) {
  const admin = membership === 'owner';
  return {
    id: ws.id,
    organization_id: ws.id,
    name: ws.name,
    premium: true,
    business_ws: true,
    admin,
    role: admin ? 'admin' : 'user',
    suspended_at: null,
    server_deleted_at: null,
    default_hourly_rate: ws.defaultHourlyRate,
    rate_last_updated: null,
    default_currency: ws.defaultCurrency,
    only_admins_may_create_projects: false,
    only_admins_may_create_tags: false,
    only_admins_see_team_dashboard: false,
    projects_billable_by_default: false,
    projects_private_by_default: true,
    projects_enforce_billable: false,
    limit_public_project_data: false,
    last_modified: togglTime(ws.updatedAt),
    reports_collapse: true,
    rounding: ws.rounding,
    rounding_minutes: ws.roundingMinutes,
    api_token: undefined,
    at: togglTime(ws.updatedAt),
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

export function serializeInvite(invite: AccountToken) {
  return { id: invite.id, role: invite.role, note: invite.note, created_by: invite.createdBy,
    created_at: togglTime(invite.createdAt), expires_at: togglTime(invite.expiresAt) };
}
export interface NewAccountInput { email: string; fullname: string; timezone: string; password: string }
export function readNewAccount(body: Record<string, unknown>): NewAccountInput {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const fullname = typeof body.fullname === 'string' ? body.fullname.trim().slice(0, 255) : '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address');
  const timezone = body.timezone === undefined || body.timezone === '' ? 'UTC' : typeof body.timezone === 'string' ? canonicalTimeZone(body.timezone) : null;
  if (!timezone) throw badRequest('Invalid timezone');
  return { email, fullname, timezone, password: readNewPassword(body.password) };
}
export function readProfileChanges(body: Record<string, unknown>): AccountChanges {
  const email = optionalString(body.email, 'email', 255)?.trim();
  if (email !== undefined && !/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('Invalid email');
  const fullName = optionalString(body.fullname, 'fullname', 255);
  const requestedZone = optionalString(body.timezone, 'timezone', 64);
  const timezone = requestedZone === undefined ? undefined : canonicalTimeZone(requestedZone);
  if (timezone === null) throw badRequest('Invalid timezone');
  const beginningOfWeek = body.beginning_of_week;
  if (beginningOfWeek !== undefined && (!Number.isInteger(beginningOfWeek) || typeof beginningOfWeek !== 'number' || beginningOfWeek < 0 || beginningOfWeek > 6)) throw badRequest('Invalid beginning_of_week');
  const defaultWorkspaceId = optionalId(body.default_workspace_id, 'default_workspace_id');
  return { email, fullName, timezone, beginningOfWeek: beginningOfWeek as number | undefined, defaultWorkspaceId: defaultWorkspaceId ?? undefined };
}
