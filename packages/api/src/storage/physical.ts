import type { ColumnType, Generated, GeneratedAlways } from 'kysely';

// Physical rows stay inside storage. Numeric server values are checked by conversion.ts.
type Int = ColumnType<number | string, number, number>;
type DefaultInt = ColumnType<number | string, number | undefined, number>;
type Real = ColumnType<number | string, number, number>;

export interface UsersRow {
  id: DefaultInt;
  email: string;
  fullname: Generated<string>;
  password_hash: string;
  api_token: string;
  timezone: Generated<string>;
  beginning_of_week: DefaultInt;
  default_workspace_id: Int | null;
  preferences: Generated<string>;
  created_at: string;
  updated_at: string;
  role: Generated<string>;
  disabled_at: string | null;
  email_key: GeneratedAlways<string | Uint8Array>;
}

export interface WorkspacesRow {
  id: DefaultInt;
  name: string;
  default_currency: Generated<string>;
  default_hourly_rate: Real | null;
  rounding: DefaultInt;
  rounding_minutes: DefaultInt;
  created_at: string;
  updated_at: string;
}

export interface SessionsRow {
  token_hash: string;
  user_id: Int;
  created_at: string;
  expires_at: string;
  user_agent: Generated<string>;
}

export interface ClientsRow {
  id: DefaultInt;
  workspace_id: Int;
  name: string;
  notes: string | null;
  archived: DefaultInt;
  created_at: string;
  updated_at: string;
  name_key: GeneratedAlways<string | Uint8Array>;
}

export interface ProjectsRow {
  id: DefaultInt;
  workspace_id: Int;
  client_id: Int | null;
  name: string;
  color: string;
  active: DefaultInt;
  is_private: DefaultInt;
  billable: DefaultInt;
  estimated_hours: Real | null;
  rate: Real | null;
  currency: string | null;
  fixed_fee: Real | null;
  start_date: string | null;
  end_date: string | null;
  template: DefaultInt;
  created_at: string;
  updated_at: string;
  name_key: GeneratedAlways<string | Uint8Array>;
  client_scope: GeneratedAlways<number | string>;
}

export interface TasksRow {
  id: DefaultInt;
  workspace_id: Int;
  project_id: Int;
  name: string;
  active: DefaultInt;
  estimated_seconds: Int | null;
  created_at: string;
  updated_at: string;
  name_key: GeneratedAlways<string | Uint8Array>;
}

export interface TagsRow {
  id: DefaultInt;
  workspace_id: Int;
  name: string;
  created_at: string;
  updated_at: string;
  name_key: GeneratedAlways<string | Uint8Array>;
}

export interface TimeEntriesRow {
  id: DefaultInt;
  workspace_id: Int;
  user_id: Int;
  project_id: Int | null;
  task_id: Int | null;
  description: Generated<string>;
  start: string;
  stop: string | null;
  billable: DefaultInt;
  duronly: DefaultInt;
  created_with: Generated<string>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  all_day: DefaultInt;
  running_user_id?: GeneratedAlways<number | string | null>;
}

export interface TimeEntryTagsRow {
  time_entry_id: Int;
  tag_id: Int;
}

export interface WorkspaceUsersRow {
  workspace_id: Int;
  user_id: Int;
  role: string;
}

export interface InstanceSettingsRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: Int | null;
}

export interface AccountTokensRow {
  id: DefaultInt;
  token_hash: string;
  kind: string;
  role: string | null;
  note: string | null;
  user_id: Int | null;
  created_by: Int | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface PomodoroSessionsRow {
  user_id: Int;
  entry_id: Int;
  work_minutes: Int;
  short_rest_minutes: Int;
  long_rest_minutes: Int;
  long_rest_every: Int;
  phase_kind: string;
  phase_start: string;
  completed: Int;
}

export interface PauseChainsRow {
  user_id: Int;
  workspace_id: Int;
  project_id: Int | null;
  task_id: Int | null;
  description: string;
  tag_ids_json: string;
  billable: Int;
  seconds: Int;
  clone_entry_id: Int | null;
}

export interface TimerStatesRow {
  user_id: Int;
  revision: Int;
  fingerprint: string;
  discarded_entry_id: Int | null;
  discarded_start: string | null;
  discarded_stop: string | null;
}

export interface PhysicalDatabase {
  users: UsersRow;
  workspaces: WorkspacesRow;
  sessions: SessionsRow;
  clients: ClientsRow;
  projects: ProjectsRow;
  tasks: TasksRow;
  tags: TagsRow;
  time_entries: TimeEntriesRow;
  time_entry_tags: TimeEntryTagsRow;
  workspace_users: WorkspaceUsersRow;
  instance_settings: InstanceSettingsRow;
  account_tokens: AccountTokensRow;
  pomodoro_sessions: PomodoroSessionsRow;
  pause_chains: PauseChainsRow;
  timer_states: TimerStatesRow;
  storage_migrations: { version: Int; name: string; checksum: string; state: string; schema_hash: string | null };
}
