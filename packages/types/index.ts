/** Type-only shapes shared by the packages. No runtime code: every import is `import type`. */

export interface Me {
  id: number;
  api_token: string;
  email: string;
  fullname: string;
  timezone: string;
  default_workspace_id: number;
  beginning_of_week: number;
  /** Tokkl only: the instance role. Only admins reach /api/app/admin. */
  role: UserRole;
  /** Tokkl only: the instance time resolution in minutes. */
  time_resolution_minutes: number;
}

export type UserRole = 'admin' | 'user';

/** An `/api/app` feature a client may rely on; docs/PRD.md describes each one. */
export type ServerCapability =
  | 'app-preferences'
  | 'timer-actions'
  | 'timer-edit'
  | 'pomodoro-revision'
  | 'pause-revision'
  | 'timer-edit-entry'
  | 'idempotency-keys'
  | 'catalog-revision'
  | 'latest-entry';

/** Tokkl only. Clients test a capability instead of guessing from a 404; older servers omit these fields. */
export interface ServerApi {
  /** Goes up when an existing `/api/app` contract changes in a way clients must know about. */
  api_version: number;
  /** Additive; a client ignores names it does not know. */
  capabilities: ServerCapability[];
}

/** Grows with every write that changes the v9 project list, apart from tracked totals and `status`. */
export interface CatalogRevision {
  revision: number;
}

export interface AdminAccount {
  id: number;
  email: string;
  fullname: string;
  role: UserRole;
  created_at: string;
  disabled_at: string | null;
}

/** The link token is never listed. */
export interface Invite {
  id: number;
  role: UserRole;
  note: string | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
}

/** The only response that carries the reset token. */
export interface PasswordResetLink {
  url: string;
  expires_at: string;
}

export interface InstanceSettings {
  session_days: number;
  invite_days: number;
  /** A divisor of 60; 5 by default. */
  time_resolution_minutes: number;
}

export type DurationFormat = 'improved' | 'classic' | 'decimal';

export interface Favorite {
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

export interface Preferences {
  date_format: string;
  timeofday_format: string;
  duration_format: DurationFormat;
  collapseTimeEntries: boolean;
  manualMode: boolean;
  keyboard_shortcuts_enabled: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Integer from 1 to 180. */
  pomodoro_focus_interval_in_minutes: number;
  /** Integer from 1 to 60. */
  pomodoro_break_interval_in_minutes: number;
  /** Integer from 1 to 60. */
  pomodoro_long_break_interval_in_minutes: number;
  /** Work phases before a long break replaces the short one; integer from 1 to 12. */
  pomodoro_long_break_every: number;
  long_timer_reminder_enabled: boolean;
  /** Hours before asking whether a running timer was forgotten; integer from 1 to 168. */
  long_timer_reminder_hours: number;
  showTimeInTitle?: boolean;
  favorites?: Favorite[];
  [key: string]: unknown;
}

export interface Workspace {
  id: number;
  name: string;
  default_currency: string;
  default_hourly_rate: number | null;
  rounding: number;
  rounding_minutes: number;
}

export interface Client {
  id: number;
  wid: number;
  name: string;
  notes: string | null;
  archived: boolean;
}

export interface Project {
  id: number;
  workspace_id: number;
  client_id: number | null;
  client_name: string | null;
  name: string;
  color: string;
  active: boolean;
  billable: boolean;
  estimated_hours: number | null;
  rate: number | null;
  currency: string | null;
  actual_seconds: number;
  status: string;
}

export interface Task {
  id: number;
  project_id: number;
  name: string;
  active: boolean;
  estimated_seconds: number | null;
  tracked_seconds: number;
}

export interface Tag {
  id: number;
  workspace_id: number;
  name: string;
}

export interface TimeEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  task_id: number | null;
  billable: boolean;
  start: string;
  stop: string | null;
  duration: number;
  description: string;
  tags: string[];
  tag_ids: number[];
  at: string;
  server_deleted_at: string | null;
  /** A no-time entry: start is local midnight of its day, and only its date and duration count. */
  all_day: boolean;
  project_name?: string | null;
  project_color?: string | null;
  client_name?: string | null;
  task_name?: string | null;
}

export type PomodoroPhaseKind = 'work' | 'shortRest' | 'longRest';

/** Clients pick the sound for the phase end from it. */
export type PomodoroTransition = 'workToShortRest' | 'shortRestToWork' | 'workToLongRest' | 'longRestToWork';

/**
 * Lives from Pause until Discard, a start that is not a resume, or a stop of the resumed clone.
 * Resume starts a clone with these fields.
 */
export interface TimerPause {
  /** True while no clone runs. */
  paused: boolean;
  /** Seconds the chain's stopped entries stored, after snapping. */
  seconds: number;
  workspace_id: number;
  description: string;
  project_id: number | null;
  task_id: number | null;
  /** The tags a resumed clone gets, in name order. */
  tag_ids: number[];
  /** The names of `tag_ids`, in the same order. */
  tags: string[];
  billable: boolean;
  /** Null while paused. */
  clone_entry_id: number | null;
}

export interface TimerPomodoroPhase {
  kind: PomodoroPhaseKind;
  /** The session start or the instant Next phase was confirmed; ISO 8601 with milliseconds. */
  start: string;
  /** Work phases ended since the session started or the last long rest ended. A rest counts the work phase it follows. */
  completed: number;
  /** When the phase reaches its planned length. A client rings from here on until the phase changes. */
  planned_end: string;
}

/** Its open pomodoro is the running entry. */
export interface TimerPomodoro {
  /** The lengths the session started with, in minutes. */
  work_minutes: number;
  short_rest_minutes: number;
  long_rest_minutes: number;
  long_rest_every: number;
  phase: TimerPomodoroPhase;
  upcoming_phase: PomodoroPhaseKind;
  transition: PomodoroTransition;
  /** The pomodoro's place in the cycle, for "Pomodoro N of `long_rest_every`". */
  number: number;
  entry_id: number;
  /** ISO 8601 with milliseconds. */
  pomodoro_start: string;
}

/** Too short to keep: the stop trashed it with zero length on its snapped start. */
export interface DiscardedPomodoro {
  entry_id: number;
  start: string;
  stop: string;
}

/** Holds at most one of a pause chain and a Pomodoro session. */
export interface TimerState {
  /** Goes up by one on every change to the running entry, the pause chain or the session, from any client. */
  revision: number;
  /** ISO 8601 with milliseconds. Clients correct their clock with it. */
  server_time: string;
  /** As GET /api/v9/me/time_entries/current?meta=true returns it. */
  running_entry: TimeEntry | null;
  pause: TimerPause | null;
  pomodoro: TimerPomodoro | null;
  /** The pomodoro that the change which produced this revision discarded, if any. */
  discarded_pomodoro: DiscardedPomodoro | null;
}

export interface TimeEntryInput {
  description?: string;
  project_id?: number | null;
  task_id?: number | null;
  billable?: boolean;
  start?: string;
  /** YYYY-MM-DD; the day of a no-time entry, or the date part of `start`. */
  start_date?: string;
  stop?: string | null;
  duration?: number;
  all_day?: boolean;
  tags?: string[];
  tag_ids?: number[];
  tag_action?: 'add' | 'delete';
}

export interface ReportGroup {
  id: number | null;
  title: string;
  color: string | null;
  seconds: number;
  billable_seconds: number;
  amount_cents: number;
  sub_groups: ReportGroup[];
}

export interface ReportEntry {
  id: number;
  description: string;
  start: string;
  stop: string;
  seconds: number;
  billable: boolean;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  client_name: string | null;
  task_name: string | null;
  tags: string[];
  amount_cents: number | null;
  currency: string;
  all_day: boolean;
}

export interface Report {
  start_date: string;
  end_date: string;
  resolution: 'day' | 'week' | 'month';
  totals: {
    seconds: number;
    billable_seconds: number;
    entry_count: number;
    amounts: Array<{ currency: string; cents: number }>;
  };
  series: Array<{ start: string; seconds: number; billable_seconds: number }>;
  groups: ReportGroup[];
}

export type Grouping = 'projects' | 'clients' | 'tags' | 'time_entries' | 'tasks';

export interface ReportQuery {
  start_date: string;
  end_date: string;
  grouping?: Grouping;
  sub_grouping?: Grouping;
  project_ids?: Array<number | null>;
  client_ids?: Array<number | null>;
  tag_ids?: Array<number | null>;
  exclude_project_ids?: Array<number | null>;
  exclude_client_ids?: Array<number | null>;
  exclude_tag_ids?: Array<number | null>;
  billable?: boolean;
  description?: string;
}

export interface ImportUser {
  /** Opaque. Pass it back unchanged as the `user` query parameter; show `user` and `email` instead. */
  key: string;
  user: string;
  email: string;
  rows: number;
}

export interface ImportResult {
  dry_run: boolean;
  rows: number;
  created: number;
  skipped_duplicates: number;
  created_projects: string[];
  created_clients: string[];
  errors: Array<{ row: number; message: string }>;
  /** In order of first appearance; empty when the file has no User or Email column. */
  users: ImportUser[];
  /** Rows left out because their Toggl user was not selected, one item per user. */
  skipped: Array<{ rows: number; reason: string }>;
}

/** GET /api/app/trash lists only the `limit` most recent, so a `total` above `limit` means some were left out. */
export interface TrashTotal {
  total: number;
  limit: number;
}

export interface DetailedReportPage {
  total: number;
  /** The last page when the requested one is past the end. */
  page: number;
  page_size: number;
  pages: number;
  /** Whether any matching entry, on any page, has a billable amount. */
  has_amounts: boolean;
  entries: ReportEntry[];
}

export interface WeeklyReport {
  start_date: string;
  end_date: string;
  mode: 'days' | 'weeks';
  columns: Array<{ start: string; end: string }>;
  rows: Array<{ id: number | null; title: string; color: string | null; cells: number[]; total: number }>;
  column_totals: number[];
  total: number;
}

/** GET /api/app/bounds: the first and last day with an entry, or null with none. */
export interface EntryBounds {
  first_date: string | null;
  last_date: string | null;
}

export interface BulkPatchResult {
  success: number[];
  failure: Array<{ id: number; message: string }>;
}

export interface PatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

/** What a restore added, or would add on a dry run. */
export interface JsonRestoreResult {
  dry_run: boolean;
  clients: number;
  projects: number;
  tasks: number;
  tags: number;
  time_entries: number;
  skipped_duplicates: number;
  errors: Array<{ entity: string; id: unknown; message: string }>;
}

/** An older server sends only `setup_required`. */
export interface AppStatus extends ServerApi {
  setup_required: boolean;
  /** The Pomodoro session lengths `POST /api/app/pomodoro` and the preferences accept. */
  pomodoro_limits: PomodoroLimits;
}

/** Inclusive whole-number range, and the length a new account starts with. */
export interface PomodoroLimit {
  min: number;
  max: number;
  default: number;
}

export interface PomodoroLimits {
  work_minutes: PomodoroLimit;
  short_rest_minutes: PomodoroLimit;
  long_rest_minutes: PomodoroLimit;
  long_rest_every: PomodoroLimit;
}

/** Carries the only copy of the invite link. */
export interface CreatedInvite extends Invite {
  url: string;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}
