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
  project_name?: string | null;
  project_color?: string | null;
  client_name?: string | null;
  task_name?: string | null;
}

/** Fields accepted when creating or updating an entry through the Toggl-compatible API. */
export interface TimeEntryInput {
  description?: string;
  project_id?: number | null;
  task_id?: number | null;
  billable?: boolean;
  start?: string;
  stop?: string | null;
  duration?: number;
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

export interface ImportResult {
  dry_run: boolean;
  rows: number;
  created: number;
  skipped_duplicates: number;
  created_projects: string[];
  created_clients: string[];
  errors: Array<{ row: number; message: string }>;
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
