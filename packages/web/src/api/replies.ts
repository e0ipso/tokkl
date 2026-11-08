import {
  array,
  boolean,
  instant,
  integer,
  nullable,
  number,
  object,
  oneOf,
  optional,
  string,
  type Decoder,
} from './decode.ts';
import type {
  Client,
  DetailedReportPage,
  DiscardedPomodoro,
  EntryBounds,
  Me,
  Project,
  Report,
  ReportEntry,
  ReportGroup,
  Tag,
  Task,
  TimeEntry,
  TimerPause,
  TimerPomodoro,
  TimerPomodoroPhase,
  TimerState,
  WeeklyReport,
  Workspace,
} from './types.ts';

/**
 * Decoders for the replies the views compute with: the account, the catalogs, entries, the timer
 * state and reports. Preferences are left as they come: their type is an open record of whatever the
 * clients saved. Ids, revisions, counts and page numbers are safe integers (`integer`), other numbers
 * finite (`number`), and timestamps RFC 3339 instants (`instant`); calendar days stay `string`.
 */

export const meReply: Decoder<Me> = object<Me>({
  id: integer,
  api_token: string,
  email: string,
  fullname: string,
  timezone: string,
  default_workspace_id: integer,
  beginning_of_week: integer,
  role: oneOf('admin', 'user'),
  time_resolution_minutes: integer,
});

export const workspaceReply: Decoder<Workspace> = object<Workspace>({
  id: integer,
  name: string,
  default_currency: string,
  default_hourly_rate: nullable(number),
  rounding: integer,
  rounding_minutes: integer,
});

export const clientReply: Decoder<Client> = object<Client>({
  id: integer,
  wid: integer,
  name: string,
  notes: nullable(string),
  archived: boolean,
});

export const projectReply: Decoder<Project> = object<Project>({
  id: integer,
  workspace_id: integer,
  client_id: nullable(integer),
  client_name: nullable(string),
  name: string,
  color: string,
  active: boolean,
  billable: boolean,
  estimated_hours: nullable(number),
  rate: nullable(number),
  currency: nullable(string),
  actual_seconds: number,
  status: string,
});

export const taskReply: Decoder<Task> = object<Task>({
  id: integer,
  project_id: integer,
  name: string,
  active: boolean,
  estimated_seconds: nullable(number),
  tracked_seconds: number,
});

export const tagReply: Decoder<Tag> = object<Tag>({ id: integer, workspace_id: integer, name: string });

export const clientListReply = array(clientReply);
export const projectListReply = array(projectReply);
export const taskListReply = array(taskReply);
export const tagListReply = array(tagReply);

const metaName = optional(nullable(string));

export const timeEntryReply: Decoder<TimeEntry> = object<TimeEntry>({
  id: integer,
  workspace_id: integer,
  project_id: nullable(integer),
  task_id: nullable(integer),
  billable: boolean,
  start: instant,
  stop: nullable(instant),
  duration: number,
  description: string,
  tags: array(string),
  tag_ids: array(integer),
  at: instant,
  server_deleted_at: nullable(instant),
  all_day: boolean,
  project_name: metaName,
  project_color: metaName,
  client_name: metaName,
  task_name: metaName,
});

export const entryListReply = array(timeEntryReply);

/** The running entry, or null when the timer is stopped. */
export const runningEntryReply = nullable(timeEntryReply);

const pomodoroPhaseKind = oneOf('work', 'shortRest', 'longRest');

const timerPause: Decoder<TimerPause> = object<TimerPause>({
  paused: boolean,
  seconds: number,
  workspace_id: integer,
  description: string,
  project_id: nullable(integer),
  task_id: nullable(integer),
  tag_ids: array(integer),
  tags: array(string),
  billable: boolean,
  clone_entry_id: nullable(integer),
});

const timerPomodoro: Decoder<TimerPomodoro> = object<TimerPomodoro>({
  work_minutes: number,
  short_rest_minutes: number,
  long_rest_minutes: number,
  long_rest_every: number,
  phase: object<TimerPomodoroPhase>({
    kind: pomodoroPhaseKind,
    start: instant,
    completed: integer,
    planned_end: instant,
  }),
  upcoming_phase: pomodoroPhaseKind,
  transition: oneOf('workToShortRest', 'shortRestToWork', 'workToLongRest', 'longRestToWork'),
  number: integer,
  entry_id: integer,
  pomodoro_start: instant,
});

/** The timer state of GET /api/app/timer, every timer action, a 409 from one, and the event stream. */
export const timerStateReply: Decoder<TimerState> = object<TimerState>({
  revision: integer,
  server_time: instant,
  running_entry: runningEntryReply,
  pause: nullable(timerPause),
  pomodoro: nullable(timerPomodoro),
  discarded_pomodoro: nullable(object<DiscardedPomodoro>({ entry_id: integer, start: instant, stop: instant })),
});

export const entryBoundsReply: Decoder<EntryBounds> = object<EntryBounds>({
  first_date: nullable(string),
  last_date: nullable(string),
});

const reportGroup: Decoder<ReportGroup> = object<ReportGroup>({
  id: nullable(integer),
  title: string,
  color: nullable(string),
  seconds: number,
  billable_seconds: number,
  amount_cents: number,
  // Groups nest one level per sub-grouping; the reference defers until a group is decoded.
  sub_groups: (value, at) => array(reportGroup)(value, at),
});

export const reportReply: Decoder<Report> = object<Report>({
  start_date: string,
  end_date: string,
  resolution: oneOf('day', 'week', 'month'),
  totals: object<Report['totals']>({
    seconds: number,
    billable_seconds: number,
    entry_count: integer,
    amounts: array(object<Report['totals']['amounts'][number]>({ currency: string, cents: number })),
  }),
  series: array(object<Report['series'][number]>({ start: string, seconds: number, billable_seconds: number })),
  groups: array(reportGroup),
});

const reportEntry: Decoder<ReportEntry> = object<ReportEntry>({
  id: integer,
  description: string,
  start: instant,
  stop: instant,
  seconds: number,
  billable: boolean,
  project_id: nullable(integer),
  project_name: nullable(string),
  project_color: nullable(string),
  client_name: nullable(string),
  task_name: nullable(string),
  tags: array(string),
  amount_cents: nullable(number),
  currency: string,
  all_day: boolean,
});

export const detailedReportReply: Decoder<DetailedReportPage> = object<DetailedReportPage>({
  total: integer,
  page: integer,
  page_size: integer,
  pages: integer,
  has_amounts: boolean,
  entries: array(reportEntry),
});

type WeeklyRow = WeeklyReport['rows'][number];

export const weeklyReportReply: Decoder<WeeklyReport> = object<WeeklyReport>({
  start_date: string,
  end_date: string,
  mode: oneOf('days', 'weeks'),
  columns: array(object<WeeklyReport['columns'][number]>({ start: string, end: string })),
  rows: array(
    object<WeeklyRow>({
      id: nullable(integer),
      title: string,
      color: nullable(string),
      cells: array(number),
      total: number,
    }),
  ),
  column_totals: array(number),
  total: number,
});
