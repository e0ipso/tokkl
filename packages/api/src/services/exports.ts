import type { DurationFormat } from '@tokkl/types';
import { formatDuration } from '@tokkl/common/duration';
import { addDays, dateKey, parseDateKey, startOfDay, zonedParts, pad2 } from '@tokkl/common/time';
import type { AccountExportProjection, EntryDetails, User } from '../domain/model.ts';
import { getPreferences } from '../domain/accountValues.ts';
import {
  serializeClient,
  serializeProject,
  serializeTag,
  serializeTask,
  serializeTimeEntry,
  serializeUser,
  serializeWorkspace,
} from '../presenters/toggl.ts';
import { toCsv } from '../lib/csv.ts';
import { invalidInput } from '../lib/errors.ts';

export const EXPORT_FORMAT = 'tokkl-export';
export const LEGACY_EXPORT_FORMAT = 'timetrack-export';
const EXPORT_FORMAT_VERSION = 1;
type ExportUser = Omit<User, 'passwordHash' | 'apiToken'>;
/** An account export without its entries: the part read in one go before the entries stream. */
export type ExportHead = Omit<AccountExportProjection, 'entries'>;

/**
 * The JSON export a piece at a time: `opening`, then each batch of entries (newest first) through
 * `entries`, then `closing`. The pieces concatenate into `JSON.stringify` of the whole export.
 */
export function jsonExportWriter(head: ExportHead, exportedAt: string) {
  // The serializers select public fields; credentials are absent from the input projection.
  const publicUser = { ...head.user, passwordHash: '', apiToken: '' };
  const workspaces = new Map(head.workspaces.map(w => [w.id, w]));
  const memberships = new Map(head.memberships.map(m => [m.workspaceId, m.role]));
  const whole = JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exported_at: exportedAt,
    user: serializeUser(publicUser, { includeToken: false }),
    preferences: getPreferences(publicUser),
    workspaces: head.workspaces.map(w => serializeWorkspace(w, memberships.get(w.id))),
    clients: head.clients.map(serializeClient),
    projects: head.projects.map(p => serializeProject(p, workspaces.get(p.workspaceId)!.defaultCurrency)),
    tasks: head.tasks.map(serializeTask),
    tags: head.tags.map(serializeTag),
    time_entries: [],
  });
  const closing = ']}';
  let written = false;
  return {
    /** Everything up to the entries' opening bracket. */
    opening: whole.slice(0, -closing.length),
    /** The entries of one batch, with the comma that joins them to the batch before. */
    entries(batch: EntryDetails[]): string {
      if (!batch.length) return '';
      const text = batch.map(e => JSON.stringify(serializeTimeEntry(e, { meta: true, user: publicUser }))).join(',');
      const joined = written ? `,${text}` : text;
      written = true;
      return joined;
    },
    closing,
  };
}
export const CSV_COLUMNS = [
  'User',
  'Email',
  'Client',
  'Project',
  'Task',
  'Description',
  'Billable',
  'Start date',
  'Start time',
  'End date',
  'End time',
  'Duration',
  'Tags',
] as const;
export interface CsvItem {
  clientName: string | null;
  projectName: string | null;
  taskName: string | null;
  description: string;
  billable: boolean;
  start: string;
  stop: string;
  seconds: number;
  tags: string[];
  allDay: boolean;
}
function localDateTime(iso: string, zone: string): [string, string] {
  const p = zonedParts(new Date(iso), zone);
  return [dateKey(new Date(iso), zone), `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`];
}
type CsvUser = Pick<ExportUser, 'fullName' | 'email' | 'timezone'>;
function togglCsvRow(item: CsvItem, user: CsvUser, durationFormat: DurationFormat): Array<string | number | null> {
  const [startDate, startTime] = localDateTime(item.start, user.timezone),
    [endDate, endTime] = localDateTime(item.stop, user.timezone);
  return [
    user.fullName,
    user.email,
    item.clientName,
    item.projectName,
    item.taskName,
    item.description,
    item.billable ? 'Yes' : 'No',
    startDate,
    item.allDay ? '' : startTime,
    endDate,
    item.allDay ? '' : endTime,
    formatDuration(item.seconds, durationFormat),
    item.tags.join(', '),
  ];
}
/** The header line of Toggl's time entry CSV. */
export const togglCsvHeader = (): string => toCsv([[...CSV_COLUMNS]]);
/** The lines of `items` without the header. The header and the chunks concatenate into one CSV. */
export function togglCsvLines(items: CsvItem[], user: CsvUser, durationFormat: DurationFormat = 'improved'): string {
  return items.length ? toCsv(items.map(item => togglCsvRow(item, user, durationFormat))) : '';
}
export function toTogglCsv(items: CsvItem[], user: CsvUser, durationFormat: DurationFormat = 'improved'): string {
  return togglCsvHeader() + togglCsvLines(items, user, durationFormat);
}
/**
 * The CSV export a piece at a time: `header`, then each batch of entries (oldest first) through
 * `entries`. Only stopped entries that start inside `range`, read as days in the user's time zone,
 * are written. An invalid range fails here, before anything is written.
 */
export function csvExportWriter(
  user: CsvUser,
  range: { from?: string; to?: string },
  durationFormat: DurationFormat = 'improved',
) {
  let from: string | undefined, to: string | undefined;
  if (range.from) {
    if (!parseDateKey(range.from)) throw invalidInput('Invalid start_date: expected YYYY-MM-DD');
    from = startOfDay(range.from, user.timezone).toISOString();
  }
  if (range.to) {
    if (!parseDateKey(range.to)) throw invalidInput('Invalid end_date: expected YYYY-MM-DD');
    to = startOfDay(addDays(range.to, 1), user.timezone).toISOString();
  }
  return {
    header: togglCsvHeader(),
    entries(batch: EntryDetails[]): string {
      const items: CsvItem[] = [];
      for (const e of batch)
        if (e.stop && (!from || e.start >= from) && (!to || e.start < to))
          items.push({
            clientName: e.client?.name ?? null,
            projectName: e.project?.name ?? null,
            taskName: e.task?.name ?? null,
            description: e.description,
            billable: e.billable,
            start: e.start,
            stop: e.stop,
            seconds: Math.floor((Date.parse(e.stop) - Date.parse(e.start)) / 1000),
            tags: e.tags.map(t => t.name),
            allDay: e.allDay,
          });
      return togglCsvLines(items, user, durationFormat);
    },
  };
}
