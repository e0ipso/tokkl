import { CsvLimitError, parseCsv, type CsvLimits } from '../lib/csv.ts';
import { BoundedCache } from '../lib/boundedCache.ts';
import { invalidInput } from '../lib/errors.ts';
import { parseDuration } from '@tokkl/common/duration';
import { pad2, zonedToUtc } from '@tokkl/common/time';
import type { ImportResult, ImportUser } from '@tokkl/types';
import type { OperationContext } from '../domain/ports.ts';
import { createClient, createProject, createTask } from '../domain/catalogs.ts';
import { parseNewClient, parseNewProject, parseNewTask } from '../commands/catalogs.ts';
import { parseNewEntry } from '../commands/timeEntries.ts';
import type { EntryRepositories } from '../domain/entryAccess.ts';
import { withExactEntryImport, type ExactEntryImport } from '../domain/entryImport.ts';
import { noTimeSpan } from '../domain/entrySpans.ts';
import type { User } from '../domain/model.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import { MAX_IMPORT_ERRORS, cancelBeforeCommit, checkCancelled, importError, protectImport } from './importGuards.ts';
const HEADER_ALIASES: Record<string, string[]> = {
  user: ['user'],
  email: ['email'],
  client: ['client'],
  project: ['project'],
  task: ['task'],
  description: ['description'],
  billable: ['billable'],
  startDate: ['start date'],
  startTime: ['start time'],
  endDate: ['end date', 'stop date'],
  endTime: ['end time', 'stop time'],
  duration: ['duration'],
  tags: ['tags'],
};

const MAX_ROWS = 100_000;
/** Far beyond a Toggl export, which has about twenty columns and short values. */
const MAX_COLUMNS = 1000;
const MAX_VALUE_LENGTH = 1_000_000;
const LIMITS: CsvLimits = { maxRows: MAX_ROWS + 1, maxFieldsPerRow: MAX_COLUMNS, maxFieldLength: MAX_VALUE_LENGTH };
const LIMIT_MESSAGES: Readonly<Record<keyof CsvLimits, string>> = {
  maxRows: `At most ${MAX_ROWS} rows per import`,
  maxFieldsPerRow: `At most ${MAX_COLUMNS} columns per row`,
  maxFieldLength: `A value is longer than ${MAX_VALUE_LENGTH} characters`,
};
/** Catalog names an import remembers; a failed row clears them. */
const NAME_CACHE = 256;

function columnIndex(header: string[]): Record<string, number> {
  const normalized = header.map(name => name.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const position = normalized.findIndex(name => aliases.includes(name));
    if (position >= 0) index[key] = position;
  }
  return index;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const parsed = parseLooseDate(value);
  if (!parsed) return null;
  // Reject dates like 2026-02-31 instead of letting Date.UTC roll them into March.
  const check = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (check.getUTCMonth() !== parsed.month - 1 || check.getUTCDate() !== parsed.day) return null;
  return parsed;
}

function parseLooseDate(value: string): { year: number; month: number; day: number } | null {
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  // Dots and dashes mean day first; slashes follow Toggl's US default (month first) unless that is impossible.
  const dayFirst = !value.includes('/') || a > 12;
  return { year: Number(match[3]), month: dayFirst ? b : a, day: dayFirst ? a : b };
}

function parseTime(value: string): { hour: number; minute: number; second: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[4]?.toLowerCase().replace(/\./g, '');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function instant(dateValue: string, timeValue: string, timeZone: string): Date | null {
  const date = parseDate(dateValue.trim());
  const time = parseTime(timeValue);
  if (!date || !time) return null;
  return zonedToUtc(date.year, date.month, date.day, time.hour, time.minute, time.second, timeZone);
}

/** The `YYYY-MM-DD` key of a date cell, or null when it is not a real date. */
function dayKey(dateValue: string): string | null {
  const date = parseDate(dateValue.trim());
  return date ? `${date.year}-${pad2(date.month)}-${pad2(date.day)}` : null;
}

/**
 * The seconds in a Duration cell. Besides the shared duration grammar it reads the classic format's
 * "m:ss min" for spans under an hour, which the grammar would take for hours and minutes.
 */
function csvDuration(value: string): number | null {
  const minutes = /^(\d+):([0-5]\d) min$/.exec(value.trim());
  return minutes ? Number(minutes[1]) * 60 + Number(minutes[2]) : parseDuration(value);
}

/** Undoes the quote prefix that spreadsheet-safe CSV writers add before =, +, - and @. */
function unescapeCell(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

/**
 * How a selection names a Toggl user. JSON keeps the pair unambiguous, so User "Alice" with Email
 * "a@x" and User "Alice <a@x>" with no Email stay two users.
 */
function userKey(name: string, email: string): string {
  return JSON.stringify([name, email]);
}

/** How the import shows a Toggl user to people: "Name <email>", or whichever of the two it has. */
function userLabel({ user, email }: ImportUser): string {
  return user && email ? `${user} <${email}>` : user || email;
}

/** Rows a selection leaves out, with the reason the import reports for them. */
function skippedReason(found: ImportUser): string {
  const label = userLabel(found);
  return label ? `Rows from ${label} were not selected` : 'Rows without a Toggl user were not selected';
}

type Cell = (row: string[], key: string) => string;

/** A parsed Toggl detailed CSV: its rows without the header, and `cell` to read one trimmed value. */
interface TogglCsvTable {
  rows: string[][];
  cell: Cell;
  hasUsers: boolean;
}

/** Parses the file within the import limits, giving the event loop turns as it reads. */
async function parseLimited(text: string): Promise<string[][]> {
  try {
    return await parseCsv(text, LIMITS);
  } catch (error) {
    if (error instanceof CsvLimitError) throw invalidInput(LIMIT_MESSAGES[error.limit]);
    throw error;
  }
}

/**
 * Parses the file and checks it has the columns an import needs. Run it before the import's
 * transaction, so a large file is read without holding the database.
 */
export async function readTogglCsv(text: string): Promise<TogglCsvTable> {
  const rows = await parseLimited(text),
    header = rows.shift();
  if (!header) throw invalidInput('The file is empty');
  const col = columnIndex(header);
  if (col.startDate === undefined || col.startTime === undefined)
    throw invalidInput(
      'Missing "Start date" and "Start time" columns. Export a Detailed report as CSV from Toggl Track.',
    );
  if (col.duration === undefined && (col.endDate === undefined || col.endTime === undefined))
    throw invalidInput('Missing "End date"/"End time" or "Duration" columns.');
  const cell: Cell = (row, key) => (col[key] === undefined ? '' : unescapeCell((row[col[key]!] ?? '').trim()));
  return { rows, cell, hasUsers: col.user !== undefined || col.email !== undefined };
}

/** The Toggl user of every row and the users with their row counts, when the file has user columns. */
function tableUsers(rows: string[][], cell: Cell, hasUsers: boolean) {
  const rowUsers = rows.map(row => (hasUsers ? userKey(cell(row, 'user'), cell(row, 'email')) : ''));
  const users = new Map<string, ImportUser>();
  if (hasUsers)
    rows.forEach((row, i) => {
      const key = rowUsers[i]!,
        found = users.get(key);
      if (found) found.rows++;
      else users.set(key, { key, user: cell(row, 'user'), email: cell(row, 'email'), rows: 1 });
    });
  return { rowUsers, users };
}

/** The selected user keys, or null for every row. A real import of several users needs a choice. */
function selection(users: Map<string, ImportUser>, options: { dryRun: boolean; users?: string[] }) {
  const selected = options.users ? new Set(options.users) : null;
  if (selected && !selected.size) throw invalidInput('Choose whose rows to import.');
  for (const key of selected ?? [])
    if (!users.has(key)) throw invalidInput(`No rows in the file belong to the Toggl user key ${key}`);
  if (!selected && users.size > 1 && !options.dryRun)
    throw invalidInput(`The file has rows from ${users.size} Toggl users. Choose whose rows to import.`);
  return selected;
}

interface RowSpan {
  start: Date;
  stop: Date;
  /** Set for a row with a date and duration but no times. */
  noTime: { day: string; duration: number } | null;
}

/** The exact span of a row in the user's zone. Failures are row errors, reported with their message. */
function rowSpan(row: string[], cell: Cell, user: User): RowSpan {
  if (!cell(row, 'startTime') && !cell(row, 'endTime') && cell(row, 'duration') !== '') {
    const day = dayKey(cell(row, 'startDate'));
    if (!day) throw new Error('Invalid start date');
    const duration = csvDuration(cell(row, 'duration'));
    if (duration === null) throw new Error('Invalid duration');
    return { ...noTimeSpan(1, user, day, duration, { exact: true }), noTime: { day, duration } };
  }
  const start = instant(cell(row, 'startDate'), cell(row, 'startTime'), user.timezone);
  if (!start) throw new Error('Invalid start date or time');
  let stop: Date | null = null;
  if (cell(row, 'endDate') && cell(row, 'endTime'))
    stop = instant(cell(row, 'endDate'), cell(row, 'endTime'), user.timezone);
  else if (cell(row, 'duration')) {
    const seconds = csvDuration(cell(row, 'duration'));
    if (seconds !== null) stop = new Date(start.getTime() + seconds * 1000);
  }
  if (!stop) throw new Error('Invalid end time or duration');
  return { start, stop, noTime: null };
}

/** The new-entry body for one row, in the shape `parseNewEntry` takes from the API. */
function rowEntry(row: string[], cell: Cell, span: RowSpan, projectId: number | null, taskId: number | null) {
  return {
    description: cell(row, 'description'),
    ...(span.noTime
      ? { all_day: true, start_date: span.noTime.day, duration: span.noTime.duration }
      : { start: span.start.toISOString(), stop: span.stop.toISOString() }),
    project_id: projectId,
    task_id: taskId,
    billable: ['yes', 'y', 'true', '1'].includes(cell(row, 'billable').toLowerCase()),
    tags: cell(row, 'tags')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    created_with: 'tokkl-csv-import',
  };
}

/** The result before any row runs: the file's users, and which of them the selection skips. */
function emptyResult(
  dryRun: boolean,
  rows: number,
  users: Map<string, ImportUser>,
  selected: Set<string> | null,
): ImportResult {
  return {
    dry_run: dryRun,
    rows,
    created: 0,
    skipped_duplicates: 0,
    created_projects: [],
    created_clients: [],
    errors: [],
    users: [...users.values()],
    skipped: [...users.values()]
      .filter(u => selected && !selected.has(u.key))
      .map(u => ({ rows: u.rows, reason: skippedReason(u) })),
  };
}

/**
 * Finds or creates the clients, projects and tasks rows name, remembering the ids. The memory is
 * only valid while the import's guards are held, and a failed row clears it with its savepoint.
 */
function catalogNames(ctx: OperationContext<EntryRepositories>, wid: number, result: ImportResult) {
  const clients = new BoundedCache<string, number>(NAME_CACHE),
    projects = new BoundedCache<string, number>(NAME_CACHE),
    tasks = new BoundedCache<string, number>(NAME_CACHE);
  async function clientId(name: string): Promise<number> {
    const known = clients.get(name);
    if (known !== undefined) return known;
    let client = await ctx.clients.findByName(wid, name);
    if (!client) {
      client = await createClient(ctx, wid, parseNewClient({ name }));
      result.created_clients.push(name);
    }
    return clients.set(name, client.id);
  }
  return {
    async projectId(name: string, client: string): Promise<number | null> {
      if (!name) return null;
      const key = JSON.stringify([name, client]);
      if (projects.has(key)) return projects.get(key)!;
      const cid = client ? await clientId(client) : null;
      let project = await ctx.projects.findByName(wid, cid, name);
      if (!project) {
        project = await createProject(ctx, wid, parseNewProject({ name, client_id: cid }));
        result.created_projects.push(client ? `${name} (${client})` : name);
      }
      return projects.set(key, project.id);
    },
    async taskId(projectId: number | null, name: string): Promise<number | null> {
      if (!name || projectId === null) return null;
      const key = JSON.stringify([projectId, name]);
      return (
        tasks.get(key) ??
        tasks.set(
          key,
          (
            (await ctx.tasks.findByName(wid, projectId, name)) ??
            (await createTask(ctx, wid, projectId, parseNewTask({ name })))
          ).id,
        )
      );
    },
    clear() {
      clients.clear();
      projects.clear();
      tasks.clear();
    },
  };
}

/**
 * Imports the selected rows of a Toggl detailed CSV into the user's default workspace, with exact
 * times. Joins the supplied operation; each selected row owns one recoverable savepoint.
 */
export async function importTogglCsv(
  ctx: OperationContext<EntryRepositories>,
  userId: number,
  table: TogglCsvTable,
  options: { dryRun: boolean; users?: string[]; signal?: AbortSignal },
  publish: TimerPublication,
): Promise<ImportResult> {
  const { signal } = options;
  const { rows, cell, hasUsers } = table;
  const { rowUsers, users } = tableUsers(rows, cell, hasUsers);
  const selected = selection(users, options);
  const user = await protectImport(ctx, userId),
    wid = user.defaultWorkspaceId;
  const result = emptyResult(options.dryRun, rows.length, users, selected);
  const names = catalogNames(ctx, wid, result);
  async function importRow(writer: ExactEntryImport, row: string[]): Promise<void> {
    const span = rowSpan(row, cell, user);
    const pid = await names.projectId(cell(row, 'project'), cell(row, 'client')),
      description = cell(row, 'description');
    const key = { userId, start: span.start.toISOString(), stop: span.stop.toISOString(), description, projectId: pid };
    if (await ctx.entries.findDuplicate(key)) {
      result.skipped_duplicates++;
      return;
    }
    const taskId = await names.taskId(pid, cell(row, 'task'));
    await writer.create(parseNewEntry(rowEntry(row, cell, span, pid, taskId)));
    result.created++;
  }
  await withExactEntryImport(ctx, userId, wid, publish, async writer => {
    for (const [index, row] of rows.entries()) {
      if (selected && !selected.has(rowUsers[index]!)) continue;
      // Outside the row's savepoint, which would report the cancellation as the row's failure.
      checkCancelled(signal);
      const projectsBefore = result.created_projects.length,
        clientsBefore = result.created_clients.length;
      try {
        await writer.savepoint(() => importRow(writer, row));
      } catch (error) {
        names.clear();
        const message = importError(error, 'Invalid row');
        result.created_projects.length = projectsBefore;
        result.created_clients.length = clientsBefore;
        if (result.errors.length < MAX_IMPORT_ERRORS) result.errors.push({ row: index + 2, message });
      }
    }
  });
  cancelBeforeCommit(ctx, signal);
  return result;
}
