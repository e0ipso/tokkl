/**
 * Type-only declarations shared by the Tokkl packages: the JSON shapes the
 * web app reads from and sends to the API, and value shapes used by common.
 * This file must stay free of runtime code (no enums, no values), so every
 * import of it is `import type` and erases when Node strips types.
 */

export interface Me {
  id: number;
  api_token: string;
  email: string;
  fullname: string;
  timezone: string;
  default_workspace_id: number;
  beginning_of_week: number;
  /** Tokkl only, not in Toggl's /me: the instance role. Only admins reach /api/app/admin. */
  role: UserRole;
  /** Tokkl only, not in Toggl's /me: the instance time resolution in minutes. Only admins change it. */
  time_resolution_minutes: number;
}

export type UserRole = 'admin' | 'user';

/** An account as GET /api/app/admin/users lists it. */
export interface AdminAccount {
  id: number;
  email: string;
  fullname: string;
  role: UserRole;
  created_at: string;
  disabled_at: string | null;
}

/** A pending invite from GET /api/app/admin/invites. The link token is never listed. */
export interface Invite {
  id: number;
  role: UserRole;
  note: string | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
}

/**
 * A new password reset link from POST /api/app/admin/users/:id/password-reset. This response is the
 * only place the token appears.
 */
export interface PasswordResetLink {
  url: string;
  expires_at: string;
}

/** Settings an admin changes at runtime, from /api/app/admin/settings. */
export interface InstanceSettings {
  session_days: number;
  invite_days: number;
  /** Minutes every entry's duration is a multiple of: a divisor of 60, 5 by default. */
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

/** A phase of a Pomodoro session. */
export type PomodoroPhaseKind = 'work' | 'shortRest' | 'longRest';

/** The change that ends a phase. Clients pick the sound for the phase end from it. */
export type PomodoroTransition = 'workToShortRest' | 'shortRestToWork' | 'workToLongRest' | 'longRestToWork';

/**
 * A timer's pause chain, from Pause until Discard, a start that is not a resume, or a stop of the
 * resumed clone. Resume starts a clone with these fields.
 */
export interface TimerPause {
  /** True while no clone runs. */
  paused: boolean;
  /** Seconds the chain's stopped entries stored, after snapping. A pause that rounded to zero added none. */
  seconds: number;
  workspace_id: number;
  description: string;
  project_id: number | null;
  task_id: number | null;
  /** The tags a resumed clone gets, in name order. */
  tag_ids: number[];
  /** The names of `tag_ids`, in the same order, for display. */
  tags: string[];
  billable: boolean;
  /** The running clone, or null while paused. */
  clone_entry_id: number | null;
}

export interface TimerPomodoroPhase {
  kind: PomodoroPhaseKind;
  /** When the phase started: the session start or the instant Next phase was confirmed. ISO 8601 with milliseconds. */
  start: string;
  /** Work phases ended since the session started or the last long rest ended. A rest counts the work phase it follows. */
  completed: number;
  /** When the phase reaches its planned length. A client rings from here on until the phase changes. */
  planned_end: string;
}

/** A Pomodoro session. Its open pomodoro is the running entry. */
export interface TimerPomodoro {
  /** The lengths the session started with, in minutes. */
  work_minutes: number;
  short_rest_minutes: number;
  long_rest_minutes: number;
  /** A long rest follows every this many work phases. */
  long_rest_every: number;
  phase: TimerPomodoroPhase;
  /** The phase Next phase starts. */
  upcoming_phase: PomodoroPhaseKind;
  /** The change Next phase makes. */
  transition: PomodoroTransition;
  /** The pomodoro's place in the cycle, for "Pomodoro N of `long_rest_every`". */
  number: number;
  /** The open pomodoro: the running entry. */
  entry_id: number;
  /** The open pomodoro's start, the running entry's start. ISO 8601 with milliseconds. */
  pomodoro_start: string;
}

/** A pomodoro too short to keep. The stop sent it to the trash with zero length on its snapped start. */
export interface DiscardedPomodoro {
  entry_id: number;
  start: string;
  stop: string;
}

/**
 * A user's timer, from GET /api/app/timer, every timer action and the timer event stream. It holds
 * at most one of a pause chain and a Pomodoro session.
 */
export interface TimerState {
  /** Goes up by one on every change to the running entry, the pause chain or the session, from any client. */
  revision: number;
  /** The server's clock when it built this state, ISO 8601 with milliseconds. Clients correct their clock with it. */
  server_time: string;
  /** The running entry, as GET /api/v9/me/time_entries/current?meta=true returns it. */
  running_entry: TimeEntry | null;
  pause: TimerPause | null;
  pomodoro: TimerPomodoro | null;
  /** The pomodoro that the change which produced this revision discarded, if any. */
  discarded_pomodoro: DiscardedPomodoro | null;
}

/** Fields accepted when creating or updating an entry through the Toggl-compatible API. */
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

/** One distinct Toggl user found in a CSV's User and Email columns. */
export interface ImportUser {
  /**
   * Opaque identity of the User and Email pair. Pass it back unchanged as a `user` query parameter
   * to import this user's rows; show `user` and `email` instead.
   */
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
  /** Toggl users in the file, in order of first appearance; empty when it has no User or Email column. */
  users: ImportUser[];
  /** Rows left out because their Toggl user was not selected, one item per user. */
  skipped: Array<{ rows: number; reason: string }>;
}

/** Calendar and clock fields of an instant in an IANA timezone. */
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
