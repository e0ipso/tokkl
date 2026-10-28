import type { Db } from '../db/index.ts';
import { transaction } from '../db/index.ts';
import { parseCsv } from '../lib/csv.ts';
import { badRequest } from '../lib/errors.ts';
import { parseDuration } from '@tokkl/common/duration';
import { pad2, zonedToUtc } from '@tokkl/common/time';
import { createClient } from '../models/clients.ts';
import { createProject } from '../models/projects.ts';
import { createTask } from '../models/tasks.ts';
import { createTimeEntry, noTimeSpan } from '../models/timeEntries.ts';
import type { UserRow } from '../models/users.ts';
import { memberWorkspace } from '../models/workspaces.ts';
import type { ImportResult, ImportUser } from '@tokkl/types';

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
const MAX_ERRORS = 100;

function columnIndex(header: string[]): Record<string, number> {
  const normalized = header.map((name) => name.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const position = normalized.findIndex((name) => aliases.includes(name));
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

/** Undoes the quote prefix that spreadsheet-safe CSV writers add before =, +, - and @. */
function unescapeCell(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

class Rollback extends Error {}

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

/**
 * Imports a Toggl Track detailed-report CSV export. Times are read in the account's timezone.
 * Missing clients, projects, tasks and tags are created. Rows matching an existing entry
 * (same start, stop, description and project) are skipped, so re-importing a file is safe. A row
 * with a date, a duration and blank times becomes a no-time entry on that date.
 *
 * A team export holds several people's rows. `users` lists the `ImportUser.key`s whose rows to
 * import; the rest are skipped. Without it every row is imported, which a real import refuses
 * when the file has more than one Toggl user. Rows always go to `user`'s account.
 */
export function importTogglCsv(
  db: Db, user: UserRow, text: string, options: { dryRun: boolean; users?: string[] },
): ImportResult {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw badRequest('The file is empty');
  if (rows.length > MAX_ROWS) throw badRequest(`At most ${MAX_ROWS} rows per import`);
  const col = columnIndex(header);
  if (col.startDate === undefined || col.startTime === undefined) {
    throw badRequest('Missing "Start date" and "Start time" columns. Export a Detailed report as CSV from Toggl Track.');
  }
  if (col.duration === undefined && (col.endDate === undefined || col.endTime === undefined)) {
    throw badRequest('Missing "End date"/"End time" or "Duration" columns.');
  }

  const cell = (row: string[], key: string): string => {
    const position = col[key];
    return position === undefined ? '' : unescapeCell((row[position] ?? '').trim());
  };
  const hasUsers = col.user !== undefined || col.email !== undefined;
  const rowUsers = rows.map((row) => (hasUsers ? userKey(cell(row, 'user'), cell(row, 'email')) : ''));
  const users = new Map<string, ImportUser>();
  if (hasUsers) {
    rows.forEach((row, index) => {
      const key = rowUsers[index]!;
      const found = users.get(key);
      if (found) found.rows++;
      else users.set(key, { key, user: cell(row, 'user'), email: cell(row, 'email'), rows: 1 });
    });
  }
  const selected = options.users ? new Set(options.users) : null;
  for (const key of selected ?? []) {
    if (!users.has(key)) throw badRequest(`No rows in the file belong to the Toggl user key ${key}`);
  }
  if (!selected && users.size > 1 && !options.dryRun) {
    throw badRequest(`The file has rows from ${users.size} Toggl users. Choose whose rows to import.`);
  }

  // A stored default can predate membership checks or outlive the membership; never write outside it.
  const wid = memberWorkspace(db, user.id, user.default_workspace_id).id;
  const result: ImportResult = {
    dry_run: options.dryRun, rows: rows.length, created: 0, skipped_duplicates: 0,
    created_projects: [], created_clients: [], errors: [],
    users: [...users.values()],
    skipped: [...users.values()]
      .filter((found) => selected && !selected.has(found.key))
      .map((found) => ({ rows: found.rows, reason: skippedReason(found) })),
  };
  const clientIds = new Map<string, number>();
  const projectIds = new Map<string, number>();
  const taskIds = new Map<string, number>();
  const duplicate = db.prepare(`
    SELECT 1 FROM time_entries
    WHERE user_id = ? AND deleted_at IS NULL AND start = ? AND stop = ? AND description = ? AND IFNULL(project_id, 0) = ?
  `);

  const clientId = (name: string): number | null => {
    if (!name) return null;
    const key = name.toLowerCase();
    let id = clientIds.get(key);
    if (id === undefined) {
      const existing = db.prepare('SELECT id FROM clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(wid, name) as { id: number } | undefined;
      if (existing) id = existing.id;
      else {
        id = createClient(db, wid, { name }).id;
        result.created_clients.push(name);
      }
      clientIds.set(key, id);
    }
    return id;
  };

  const projectId = (name: string, client: string): number | null => {
    if (!name) return null;
    const key = `${client.toLowerCase()}\u0000${name.toLowerCase()}`;
    let id = projectIds.get(key);
    if (id === undefined) {
      const cid = clientId(client);
      const existing = db.prepare(`
        SELECT id FROM projects WHERE workspace_id = ? AND IFNULL(client_id, 0) = ? AND name = ? COLLATE NOCASE
      `).get(wid, cid ?? 0, name) as { id: number } | undefined;
      if (existing) id = existing.id;
      else {
        id = createProject(db, wid, { name, client_id: cid }).id;
        result.created_projects.push(client ? `${name} (${client})` : name);
      }
      projectIds.set(key, id);
    }
    return id;
  };

  const taskId = (name: string, pid: number | null): number | null => {
    if (!name || pid === null) return null;
    const key = `${pid}\u0000${name.toLowerCase()}`;
    let id = taskIds.get(key);
    if (id === undefined) {
      const existing = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND name = ? COLLATE NOCASE').get(pid, name) as { id: number } | undefined;
      id = existing?.id ?? createTask(db, wid, pid, { name }).id;
      taskIds.set(key, id);
    }
    return id;
  };

  const run = () => {
    rows.forEach((row, index) => {
      if (selected && !selected.has(rowUsers[index]!)) return;
      const rowNumber = index + 2;
      const createdProjects = result.created_projects.length;
      const createdClients = result.created_clients.length;
      db.exec('SAVEPOINT import_row');
      try {
        // Tokkl exports no-time entries with a date and a duration and blank times.
        const noTime = !cell(row, 'startTime') && !cell(row, 'endTime') && cell(row, 'duration') !== '';
        let start: Date | null;
        let stop: Date | null = null;
        let noTimeEntry: { day: string; duration: number } | null = null;
        if (noTime) {
          const day = dayKey(cell(row, 'startDate'));
          if (!day) throw new Error('Invalid start date');
          const duration = parseDuration(cell(row, 'duration'));
          if (duration === null) throw new Error('Invalid duration');
          noTimeEntry = { day, duration };
          ({ start, stop } = noTimeSpan(db, user, day, duration, { exact: true }));
        } else {
          start = instant(cell(row, 'startDate'), cell(row, 'startTime'), user.timezone);
          if (!start) throw new Error('Invalid start date or time');
          if (cell(row, 'endDate') && cell(row, 'endTime')) {
            stop = instant(cell(row, 'endDate'), cell(row, 'endTime'), user.timezone);
          } else if (cell(row, 'duration')) {
            const seconds = parseDuration(cell(row, 'duration'));
            if (seconds !== null) stop = new Date(start.getTime() + seconds * 1000);
          }
          if (!stop) throw new Error('Invalid end time or duration');
        }

        const pid = projectId(cell(row, 'project'), cell(row, 'client'));
        const description = cell(row, 'description');
        if (duplicate.get(user.id, start.toISOString(), stop.toISOString(), description, pid ?? 0)) {
          result.skipped_duplicates++;
          db.exec('RELEASE import_row');
          return;
        }
        const tags = cell(row, 'tags').split(',').map((tag) => tag.trim()).filter(Boolean);
        createTimeEntry(db, user, wid, {
          description,
          ...(noTimeEntry
            ? { all_day: true, start_date: noTimeEntry.day, duration: noTimeEntry.duration }
            : { start: start.toISOString(), stop: stop.toISOString() }),
          project_id: pid,
          task_id: taskId(cell(row, 'task'), pid),
          billable: ['yes', 'y', 'true', '1'].includes(cell(row, 'billable').toLowerCase()),
          tags,
          created_with: 'tokkl-csv-import',
        }, { exact: true });
        result.created++;
        db.exec('RELEASE import_row');
      } catch (error) {
        db.exec('ROLLBACK TO import_row');
        db.exec('RELEASE import_row');
        // Entities created for this row were rolled back, so forget their cached ids.
        clientIds.clear();
        projectIds.clear();
        taskIds.clear();
        result.created_projects.length = createdProjects;
        result.created_clients.length = createdClients;
        if (result.errors.length < MAX_ERRORS) {
          result.errors.push({ row: rowNumber, message: error instanceof Error ? error.message : 'Invalid row' });
        }
      }
    });
  };

  try {
    transaction(db, () => {
      run();
      if (options.dryRun) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result;
}
