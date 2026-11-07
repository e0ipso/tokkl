import { array, boolean, nullable, number, object, oneOf, optional, string, type Decoder } from './decode.ts';
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
 * clients saved.
 */

export const meReply: Decoder<Me> = object<Me>({
  id: number,
  api_token: string,
  email: string,
  fullname: string,
  timezone: string,
  default_workspace_id: number,
  beginning_of_week: number,
  role: oneOf('admin', 'user'),
  time_resolution_minutes: number,
});

export const workspaceReply: Decoder<Workspace> = object<Workspace>({
  id: number,
  name: string,
  default_currency: string,
  default_hourly_rate: nullable(number),
  rounding: number,
  rounding_minutes: number,
});

export const clientReply: Decoder<Client> = object<Client>({
  id: number,
  wid: number,
  name: string,
  notes: nullable(string),
  archived: boolean,
});

export const projectReply: Decoder<Project> = object<Project>({
  id: number,
  workspace_id: number,
  client_id: nullable(number),
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
  id: number,
  project_id: number,
  name: string,
  active: boolean,
  estimated_seconds: nullable(number),
  tracked_seconds: number,
});

export const tagReply: Decoder<Tag> = object<Tag>({ id: number, workspace_id: number, name: string });

export const clientListReply = array(clientReply);
export const projectListReply = array(projectReply);
export const taskListReply = array(taskReply);
export const tagListReply = array(tagReply);

const metaName = optional(nullable(string));

export const timeEntryReply: Decoder<TimeEntry> = object<TimeEntry>({
  id: number,
  workspace_id: number,
  project_id: nullable(number),
  task_id: nullable(number),
  billable: boolean,
  start: string,
  stop: nullable(string),
  duration: number,
  description: string,
  tags: array(string),
  tag_ids: array(number),
  at: string,
  server_deleted_at: nullable(string),
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
  workspace_id: number,
  description: string,
  project_id: nullable(number),
  task_id: nullable(number),
  tag_ids: array(number),
  tags: array(string),
  billable: boolean,
  clone_entry_id: nullable(number),
});

const timerPomodoro: Decoder<TimerPomodoro> = object<TimerPomodoro>({
  work_minutes: number,
  short_rest_minutes: number,
  long_rest_minutes: number,
  long_rest_every: number,
  phase: object<TimerPomodoroPhase>({
    kind: pomodoroPhaseKind,
    start: string,
    completed: number,
    planned_end: string,
  }),
  upcoming_phase: pomodoroPhaseKind,
  transition: oneOf('workToShortRest', 'shortRestToWork', 'workToLongRest', 'longRestToWork'),
  number: number,
  entry_id: number,
  pomodoro_start: string,
});

/** The timer state of GET /api/app/timer, every timer action, a 409 from one, and the event stream. */
export const timerStateReply: Decoder<TimerState> = object<TimerState>({
  revision: number,
  server_time: string,
  running_entry: runningEntryReply,
  pause: nullable(timerPause),
  pomodoro: nullable(timerPomodoro),
  discarded_pomodoro: nullable(object<DiscardedPomodoro>({ entry_id: number, start: string, stop: string })),
});

export const entryBoundsReply: Decoder<EntryBounds> = object<EntryBounds>({
  first_date: nullable(string),
  last_date: nullable(string),
});

const reportGroup: Decoder<ReportGroup> = object<ReportGroup>({
  id: nullable(number),
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
    entry_count: number,
    amounts: array(object<Report['totals']['amounts'][number]>({ currency: string, cents: number })),
  }),
  series: array(object<Report['series'][number]>({ start: string, seconds: number, billable_seconds: number })),
  groups: array(reportGroup),
});

const reportEntry: Decoder<ReportEntry> = object<ReportEntry>({
  id: number,
  description: string,
  start: string,
  stop: string,
  seconds: number,
  billable: boolean,
  project_id: nullable(number),
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
  total: number,
  page: number,
  page_size: number,
  pages: number,
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
      id: nullable(number),
      title: string,
      color: nullable(string),
      cells: array(number),
      total: number,
    }),
  ),
  column_totals: array(number),
  total: number,
});
