import { NO_WORKSPACE_ACCESS } from '../domain/accounts.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { addDays, dateKey, daysBetween, parseDateKey, startOfDay, startOfWeek } from '@tokkl/common/time';
import type { User, Workspace, ReportEntryProjection } from '../storage/domain.ts';
import type { Repositories } from '../storage/contracts.ts';
import { currentCredentialUser, type StorageAuthentication } from '../auth/storageMiddleware.ts';

export type IdFilter = Array<number | null>;

export interface ReportFilter {
  /** Inclusive, in the user's timezone. */
  startDate: string;
  /** Inclusive, in the user's timezone. */
  endDate: string;
  projectIds?: IdFilter;
  clientIds?: IdFilter;
  tagIds?: IdFilter;
  taskIds?: IdFilter;
  userIds?: IdFilter;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  /** Negated filters: drop entries matching any of these. `null` means "without". */
  excludeProjectIds?: IdFilter;
  excludeClientIds?: IdFilter;
  excludeTagIds?: IdFilter;
  timeEntryIds?: number[];
  billable?: boolean;
  description?: string;
  /** -1 down, 0 nearest, 1 up. Applied per entry when `roundingMinutes` > 0. */
  rounding?: number;
  roundingMinutes?: number;
}

export interface ReportEntry {
  id: number;
  description: string;
  start: string;
  stop: string;
  at: string;
  date: string;
  seconds: number;
  billable: boolean;
  projectId: number | null;
  projectName: string | null;
  projectColor: string | null;
  clientId: number | null;
  clientName: string | null;
  taskId: number | null;
  taskName: string | null;
  tags: Array<{ id: number; name: string }>;
  hourlyRateCents: number | null;
  currency: string;
  amountCents: number | null;
  allDay: boolean;
}

const MAX_RANGE_DAYS = 3660;

/** Rounding steps Toggl accepts, in minutes. 0 turns rounding off. */
export const ROUNDING_MINUTES = [0, 1, 5, 6, 10, 12, 15, 30, 60, 240];

export function validateRange(startDate: unknown, endDate: unknown, maxDays = MAX_RANGE_DAYS): { startDate: string; endDate: string } {
  if (typeof startDate !== 'string' || !parseDateKey(startDate)) throw badRequest('Invalid start_date: expected YYYY-MM-DD');
  if (typeof endDate !== 'string' || !parseDateKey(endDate)) throw badRequest('Invalid end_date: expected YYYY-MM-DD');
  const days = daysBetween(startDate, endDate);
  if (days < 0) throw badRequest('end_date must not be earlier than start_date');
  if (days + 1 > maxDays) throw badRequest(`Maximum allowed date range is ${maxDays} days`);
  return { startDate, endDate };
}

function roundSeconds(seconds: number, mode: number, minutes: number): number {
  if (minutes <= 0) return seconds;
  const step = minutes * 60;
  if (mode > 0) return Math.ceil(seconds / step) * step;
  if (mode < 0) return Math.floor(seconds / step) * step;
  return Math.round(seconds / step) * step;
}

export type ReportRepositories = Pick<Repositories, 'users' | 'workspaces' | 'sessions' | 'reports'>;
export interface ReportSource {
  readSnapshot<T>(work: (repositories: ReportRepositories) => Promise<T>): Promise<T>;
}
export type ReportUser = Pick<User, 'id' | 'fullName' | 'email' | 'timezone' | 'beginningOfWeek'>;
export type ReportWorkspace = Pick<Workspace, 'id' | 'defaultCurrency' | 'defaultHourlyRate'>;
export interface ReportData { user: ReportUser; workspace: ReportWorkspace; entries: ReportEntryProjection[] }

/** Read all related values on one checkout; release it before grouping or constructing CSV. */
export function collectReport(source: ReportSource, userId: number, workspaceId: number, filter: ReportFilter, authentication?: StorageAuthentication): Promise<ReportData> {
  return source.readSnapshot(async repositories => {
    const user = authentication
      ? authentication.user.id === userId ? await currentCredentialUser(repositories, authentication) : undefined
      : await repositories.users.get(userId);
    if (!user) throw forbidden();
    const workspace = await repositories.workspaces.forMember(userId, workspaceId);
    if (!workspace) throw forbidden(NO_WORKSPACE_ACCESS);
    const from = startOfDay(filter.startDate, user.timezone).toISOString();
    const to = startOfDay(addDays(filter.endDate, 1), user.timezone).toISOString();
    const entries = await repositories.reports.collect(userId, workspaceId, { ...filter, from, to });
    return { user: { id: user.id, fullName: user.fullName, email: user.email, timezone: user.timezone, beginningOfWeek: user.beginningOfWeek },
      workspace: { id: workspace.id, defaultCurrency: workspace.defaultCurrency, defaultHourlyRate: workspace.defaultHourlyRate }, entries };
  });
}

export function formatReportEntries(rows: ReportEntryProjection[], user: ReportUser, workspace: ReportWorkspace, filter: ReportFilter): ReportEntry[] {
  return rows.map(row => {
    const raw = Math.floor((Date.parse(row.stop) - Date.parse(row.start)) / 1000);
    const seconds = roundSeconds(raw, filter.rounding ?? 0, filter.roundingMinutes ?? 0);
    const rate = row.projectRate ?? workspace.defaultHourlyRate;
    const currency = row.projectRate !== null ? (row.projectCurrency ?? workspace.defaultCurrency) : workspace.defaultCurrency;
    const hourlyRateCents = row.billable && rate !== null ? Math.round(rate * 100) : null;
    return { id: row.id, description: row.description, start: row.start, stop: row.stop, at: row.updatedAt,
      date: dateKey(new Date(row.start), user.timezone), seconds, billable: row.billable, projectId: row.projectId,
      projectName: row.projectName, projectColor: row.projectColor, clientId: row.clientId, clientName: row.clientName,
      taskId: row.taskId, taskName: row.taskName, tags: row.tags, hourlyRateCents, currency,
      amountCents: hourlyRateCents === null ? null : Math.round((seconds / 3600) * hourlyRateCents), allDay: row.allDay };
  });
}

export interface Totals {
  seconds: number;
  billableSeconds: number;
  entryCount: number;
  amounts: Array<{ currency: string; cents: number }>;
}

export function totalsOf(entries: ReportEntry[]): Totals {
  const amounts = new Map<string, number>();
  let seconds = 0;
  let billableSeconds = 0;
  for (const entry of entries) {
    seconds += entry.seconds;
    if (entry.billable) billableSeconds += entry.seconds;
    if (entry.amountCents !== null) amounts.set(entry.currency, (amounts.get(entry.currency) ?? 0) + entry.amountCents);
  }
  return {
    seconds,
    billableSeconds,
    entryCount: entries.length,
    amounts: [...amounts].map(([currency, cents]) => ({ currency, cents })),
  };
}

export type Resolution = 'day' | 'week' | 'month';

export function resolutionFor(startDate: string, endDate: string): Resolution {
  const days = daysBetween(startDate, endDate) + 1;
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

export function timeSeries(
  entries: ReportEntry[], startDate: string, endDate: string, resolution: Resolution, beginningOfWeek: number,
): Array<{ start: string; seconds: number; billableSeconds: number }> {
  const bucketOf = (key: string): string => {
    if (resolution === 'day') return key;
    if (resolution === 'week') return startOfWeek(key, beginningOfWeek);
    return `${key.slice(0, 7)}-01`;
  };
  const buckets = new Map<string, { seconds: number; billableSeconds: number }>();
  for (let key = bucketOf(startDate); key <= endDate;) {
    buckets.set(key, { seconds: 0, billableSeconds: 0 });
    if (resolution === 'day') key = addDays(key, 1);
    else if (resolution === 'week') key = addDays(key, 7);
    else {
      const [y, m] = key.split('-').map(Number) as [number, number];
      key = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  for (const entry of entries) {
    const bucket = buckets.get(bucketOf(entry.date));
    if (!bucket) continue;
    bucket.seconds += entry.seconds;
    if (entry.billable) bucket.billableSeconds += entry.seconds;
  }
  return [...buckets].map(([start, value]) => ({ start, ...value }));
}

export type WeeklyRows = 'projects' | 'clients';

export interface WeeklyGrid {
  /** One column per day for ranges up to a week, one per week for anything longer. */
  mode: 'days' | 'weeks';
  /** Each column's first and last day inside the range. */
  columns: Array<{ start: string; end: string }>;
  rows: Array<{ id: number | null; title: string; color: string | null; cells: number[]; total: number }>;
  columnTotals: number[];
  total: number;
}

/**
 * Totals per project or client and per day or week over every entry passed in. Week columns
 * start on `beginningOfWeek`; the first and last are clipped to the range.
 */
export function weeklyGrid(
  entries: ReportEntry[], startDate: string, endDate: string, by: WeeklyRows, beginningOfWeek: number,
): WeeklyGrid {
  const mode = daysBetween(startDate, endDate) + 1 <= 7 ? 'days' : 'weeks';
  const columnOf = (key: string): string => (mode === 'days' ? key : startOfWeek(key, beginningOfWeek));
  const columns: WeeklyGrid['columns'] = [];
  const index = new Map<string, number>();
  for (let key = columnOf(startDate); key <= endDate; key = addDays(key, mode === 'days' ? 1 : 7)) {
    const last = mode === 'days' ? key : addDays(key, 6);
    index.set(key, columns.length);
    columns.push({ start: key < startDate ? startDate : key, end: last > endDate ? endDate : last });
  }
  const rows = new Map<string, WeeklyGrid['rows'][number]>();
  const columnTotals = columns.map(() => 0);
  let total = 0;
  for (const entry of entries) {
    const column = index.get(columnOf(entry.date));
    if (column === undefined) continue;
    const id = by === 'projects' ? entry.projectId : entry.clientId;
    let row = rows.get(String(id));
    if (!row) {
      row = by === 'projects'
        ? { id, title: entry.projectName ?? '', color: entry.projectColor, cells: columns.map(() => 0), total: 0 }
        : { id, title: entry.clientName ?? '', color: null, cells: columns.map(() => 0), total: 0 };
      rows.set(String(id), row);
    }
    row.cells[column]! += entry.seconds;
    row.total += entry.seconds;
    columnTotals[column]! += entry.seconds;
    total += entry.seconds;
  }
  // The "without project/client" row goes last; the rest by total, then title.
  const sorted = [...rows.values()].sort((a, b) =>
    Number(a.id === null) - Number(b.id === null) || b.total - a.total || a.title.localeCompare(b.title));
  return { mode, columns, rows: sorted, columnTotals, total };
}

export type Dimension = 'project' | 'client' | 'tag' | 'description' | 'task' | 'none';

export interface GroupKey {
  id: number | null;
  title: string;
  color: string | null;
}

/** Keys for an entry along a dimension. Tags can yield several keys; an untagged entry yields one null key. */
export function keysFor(entry: ReportEntry, dimension: Dimension): GroupKey[] {
  switch (dimension) {
    case 'project':
      return [{ id: entry.projectId, title: entry.projectName ?? '', color: entry.projectColor }];
    case 'client':
      return [{ id: entry.clientId, title: entry.clientName ?? '', color: null }];
    case 'task':
      return [{ id: entry.taskId, title: entry.taskName ?? '', color: null }];
    case 'tag':
      return entry.tags.length ? entry.tags.map((tag) => ({ id: tag.id, title: tag.name, color: null })) : [{ id: null, title: '', color: null }];
    case 'description':
      return [{ id: null, title: entry.description, color: null }];
    case 'none':
      return [{ id: null, title: '', color: null }];
  }
}

export interface Group extends GroupKey {
  seconds: number;
  billableSeconds: number;
  amountCents: number;
  entryIds: number[];
  subGroups: Group[];
}

function groupKeyString(key: GroupKey, dimension: Dimension): string {
  return dimension === 'description' ? `d:${key.title}` : `i:${key.id ?? 'none'}`;
}

export function groupEntries(entries: ReportEntry[], dimension: Dimension, subDimension: Dimension = 'none'): Group[] {
  const groups = new Map<string, { key: GroupKey; entries: ReportEntry[] }>();
  for (const entry of entries) {
    for (const key of keysFor(entry, dimension)) {
      const id = groupKeyString(key, dimension);
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { key, entries: [] }));
      group.entries.push(entry);
    }
  }
  return [...groups.values()]
    .map(({ key, entries: members }) => {
      const totals = totalsOf(members);
      return {
        ...key,
        seconds: totals.seconds,
        billableSeconds: totals.billableSeconds,
        amountCents: totals.amounts.reduce((sum, amount) => sum + amount.cents, 0),
        entryIds: members.map((member) => member.id),
        subGroups: subDimension === 'none' ? [] : groupEntries(members, subDimension),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

export function parseIdFilter(value: unknown, field: string): IdFilter | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw badRequest(`Invalid '${field}' value: expected an array`);
  if (value.length > 1000) throw badRequest(`'${field}' accepts at most 1000 ids`);
  return value.map((item) => {
    if (item === null) return null;
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item;
    throw badRequest(`Invalid '${field}' value`);
  });
}

/** Reads the filter fields shared by Toggl's Reports API v3 bodies and the app's report endpoint. */
export function filterFromBody(body: Record<string, unknown>, workspace: Workspace, maxDays?: number): ReportFilter {
  const range = validateRange(body.start_date, body.end_date ?? body.start_date, maxDays);
  if (body.billable !== undefined && body.billable !== null && typeof body.billable !== 'boolean') {
    throw badRequest("Invalid 'billable' value");
  }
  const timeEntryIds = parseIdFilter(body.time_entry_ids, 'time_entry_ids')?.filter((id): id is number => id !== null);
  const durationBound = (field: string): number | undefined => {
    const value = body[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw badRequest(`Invalid '${field}' value`);
    return value;
  };
  const minDurationSeconds = durationBound('min_duration_seconds');
  const maxDurationSeconds = durationBound('max_duration_seconds');
  if (minDurationSeconds !== undefined && maxDurationSeconds !== undefined && minDurationSeconds >= maxDurationSeconds) {
    throw badRequest('max_duration_seconds must be greater than min_duration_seconds');
  }
  const rounding = body.rounding === undefined ? undefined : Number(body.rounding);
  const roundingMinutes = body.rounding_minutes === undefined ? undefined : Number(body.rounding_minutes);
  if (roundingMinutes !== undefined && !ROUNDING_MINUTES.includes(roundingMinutes)) {
    throw badRequest(`Invalid 'rounding_minutes' value, allowed values are: '${ROUNDING_MINUTES.join(', ')}'`);
  }
  // Toggl applies the workspace rounding only when the request asks for rounding.
  const applyWorkspaceRounding = rounding !== undefined && roundingMinutes === undefined;
  return {
    ...range,
    projectIds: parseIdFilter(body.project_ids, 'project_ids'),
    clientIds: parseIdFilter(body.client_ids, 'client_ids'),
    tagIds: parseIdFilter(body.tag_ids, 'tag_ids'),
    taskIds: parseIdFilter(body.task_ids, 'task_ids'),
    userIds: parseIdFilter(body.user_ids, 'user_ids'),
    minDurationSeconds,
    maxDurationSeconds,
    excludeProjectIds: parseIdFilter(body.exclude_project_ids, 'exclude_project_ids'),
    excludeClientIds: parseIdFilter(body.exclude_client_ids, 'exclude_client_ids'),
    excludeTagIds: parseIdFilter(body.exclude_tag_ids, 'exclude_tag_ids'),
    timeEntryIds,
    billable: typeof body.billable === 'boolean' ? body.billable : undefined,
    description: typeof body.description === 'string' && body.description !== '' ? body.description : undefined,
    rounding: rounding ?? workspace.rounding,
    roundingMinutes: roundingMinutes ?? (applyWorkspaceRounding ? workspace.roundingMinutes : 0),
  };
}
