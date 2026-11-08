/**
 * A frozen copy of the whole-list report pipeline: one query for every matching entry and one for
 * their tags, a full sort in memory, and every aggregate over the complete list. The report tests
 * hold the production pipeline to the answers this copy gives on the same snapshot.
 */
import { sql, type Kysely } from 'kysely';
import { addDays, dateKey, daysBetween, startOfDay, startOfWeek } from '@tokkl/common/time';
import type { Backend } from '../../../src/storage/config.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';
import type { ReportEntryProjection, TagLabel, User, Workspace } from '../../../src/storage/domain.ts';
import type { ReportSelection } from '../../../src/storage/contracts.ts';
import { booleanValue, entityId, finiteNumber, utcInstant } from '../../../src/storage/conversion.ts';
import { reportContains, reportDuration, reportIds, reportTags } from '../../../src/storage/repositories/report-sql.ts';
import type { Dimension, OrderBy, ReportFilter, SortDirection } from '../../../src/domain/reportCommands.ts';
import type { ReportEntry } from '../../../src/services/reports.ts';
import type { JobResult, ReportJob } from '../../../src/services/reportJobs.ts';
import {
  appEntry,
  csv,
  detailedCsv,
  detailedRow,
  json,
  rangeHeaders,
  summaryCsv,
  summaryGroup,
} from '../../../src/services/reportRows.ts';
import { resolutionFor, type Group, type GroupKey, type Resolution } from '../../../src/services/reportAggregates.ts';

const nullableId = (v: number | string | null) => (v === null ? null : entityId(v));

export async function oracleCollect(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  userId: number,
  workspaceId: number,
  f: ReportSelection,
): Promise<ReportEntryProjection[]> {
  let q = db
    .selectFrom('time_entries as e')
    .leftJoin('projects as p', 'p.id', 'e.project_id')
    .leftJoin('clients as c', 'c.id', 'p.client_id')
    .leftJoin('tasks as t', 't.id', 'e.task_id')
    .where('e.user_id', '=', userId)
    .where('e.workspace_id', '=', workspaceId)
    .where('e.start', '>=', f.from)
    .where('e.start', '<', f.to)
    .where('e.stop', 'is not', null)
    .where('e.deleted_at', 'is', null);
  for (const clause of [
    reportIds('e.project_id', f.projectIds),
    reportIds('p.client_id', f.clientIds),
    reportIds('e.task_id', f.taskIds),
    reportIds('e.user_id', f.userIds),
    reportTags(f.tagIds),
  ])
    if (clause) q = q.where(clause);
  for (const clause of [
    reportIds('e.project_id', f.excludeProjectIds),
    reportIds('p.client_id', f.excludeClientIds),
    reportTags(f.excludeTagIds),
  ]) {
    if (clause) q = q.where(sql<boolean>`not coalesce(${clause}, false)`);
  }
  if (f.minDurationSeconds !== undefined) q = q.where(reportDuration(backend), '>=', f.minDurationSeconds);
  if (f.maxDurationSeconds !== undefined) q = q.where(reportDuration(backend), '<=', f.maxDurationSeconds);
  if (f.timeEntryIds?.length) q = q.where('e.id', 'in', f.timeEntryIds);
  if (f.billable !== undefined) q = q.where('e.billable', '=', Number(f.billable));
  if (f.description) q = q.where(reportContains(backend, f.description));
  const rows = await q
    .select([
      'e.id',
      'e.user_id',
      'e.workspace_id',
      'e.description',
      'e.start',
      'e.stop',
      'e.updated_at',
      'e.billable',
      'e.all_day',
      'e.project_id',
      'e.task_id',
      'p.name as project_name',
      'p.color as project_color',
      'p.rate as project_rate',
      'p.currency as project_currency',
      'c.id as client_id',
      'c.name as client_name',
      't.name as task_name',
    ])
    .orderBy('e.start')
    .orderBy('e.id')
    .execute();
  const labels = await db
    .selectFrom('time_entry_tags as et')
    .innerJoin('tags as g', 'g.id', 'et.tag_id')
    .select(['et.time_entry_id', 'g.id', 'g.name'])
    .where('et.time_entry_id', 'in', q.select('e.id'))
    .orderBy('g.name_key')
    .orderBy('g.id')
    .execute();
  const tags = new Map<number, TagLabel[]>();
  for (const r of labels) {
    const id = entityId(r.time_entry_id),
      list = tags.get(id) ?? [];
    list.push({ id: entityId(r.id), name: r.name });
    tags.set(id, list);
  }
  return rows.map(r => ({
    id: entityId(r.id),
    userId: entityId(r.user_id),
    workspaceId: entityId(r.workspace_id),
    description: r.description,
    start: utcInstant(r.start),
    stop: utcInstant(r.stop),
    updatedAt: utcInstant(r.updated_at),
    billable: booleanValue(r.billable),
    allDay: booleanValue(r.all_day),
    projectId: nullableId(r.project_id),
    taskId: nullableId(r.task_id),
    projectName: r.project_name,
    projectColor: r.project_color,
    projectRate: r.project_rate === null ? null : finiteNumber(r.project_rate),
    projectCurrency: r.project_currency,
    clientId: nullableId(r.client_id),
    clientName: r.client_name,
    taskName: r.task_name,
    tags: tags.get(entityId(r.id)) ?? [],
  }));
}

/** The UTC range a filter covers for a user in `timezone`, as the report service derives it. */
export function oracleSelection(filter: ReportFilter, timezone: string): ReportSelection {
  return {
    ...filter,
    from: startOfDay(filter.startDate, timezone).toISOString(),
    to: startOfDay(addDays(filter.endDate, 1), timezone).toISOString(),
  };
}

function roundSeconds(seconds: number, mode: number, minutes: number): number {
  if (minutes <= 0) return seconds;
  const step = minutes * 60;
  if (mode > 0) return Math.ceil(seconds / step) * step;
  if (mode < 0) return Math.floor(seconds / step) * step;
  return Math.round(seconds / step) * step;
}

type OracleUser = Pick<User, 'id' | 'fullName' | 'email' | 'timezone' | 'beginningOfWeek'>;
type OracleWorkspace = Pick<Workspace, 'id' | 'defaultCurrency' | 'defaultHourlyRate'>;

function formatEntries(
  rows: ReportEntryProjection[],
  user: OracleUser,
  workspace: OracleWorkspace,
  filter: ReportFilter,
): ReportEntry[] {
  return rows.map(row => {
    const raw = Math.floor((Date.parse(row.stop) - Date.parse(row.start)) / 1000);
    const seconds = roundSeconds(raw, filter.rounding ?? 0, filter.roundingMinutes ?? 0);
    const rate = row.projectRate ?? workspace.defaultHourlyRate;
    const currency =
      row.projectRate !== null ? (row.projectCurrency ?? workspace.defaultCurrency) : workspace.defaultCurrency;
    const hourlyRateCents = row.billable && rate !== null ? Math.round(rate * 100) : null;
    return {
      id: row.id,
      description: row.description,
      start: row.start,
      stop: row.stop,
      at: row.updatedAt,
      date: dateKey(new Date(row.start), user.timezone),
      seconds,
      billable: row.billable,
      projectId: row.projectId,
      projectName: row.projectName,
      projectColor: row.projectColor,
      clientId: row.clientId,
      clientName: row.clientName,
      taskId: row.taskId,
      taskName: row.taskName,
      tags: row.tags,
      hourlyRateCents,
      currency,
      amountCents: hourlyRateCents === null ? null : Math.round((seconds / 3600) * hourlyRateCents),
      allDay: row.allDay,
    };
  });
}

function sortDetailed(entries: ReportEntry[], orderBy: OrderBy, direction: SortDirection): ReportEntry[] {
  const dir = direction === 'ASC' ? 1 : -1;
  const sorted = [...entries];
  switch (orderBy) {
    case 'date':
    case 'user':
      sorted.sort((a, b) => dir * (a.start.localeCompare(b.start) || a.id - b.id));
      break;
    case 'duration':
      sorted.sort((a, b) => dir * (a.seconds - b.seconds || a.id - b.id));
      break;
    case 'description':
      sorted.sort((a, b) => dir * (a.description.localeCompare(b.description) || a.id - b.id));
      break;
    case 'last_update':
      sorted.sort((a, b) => dir * (a.at.localeCompare(b.at) || a.id - b.id));
      break;
  }
  return sorted;
}

function totalsOf(entries: ReportEntry[]) {
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

function timeSeries(
  entries: ReportEntry[],
  startDate: string,
  endDate: string,
  resolution: Resolution,
  beginningOfWeek: number,
) {
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

function weeklyGrid(
  entries: ReportEntry[],
  startDate: string,
  endDate: string,
  by: 'projects' | 'clients',
  beginningOfWeek: number,
) {
  const mode = daysBetween(startDate, endDate) + 1 <= 7 ? 'days' : 'weeks';
  const columnOf = (key: string): string => (mode === 'days' ? key : startOfWeek(key, beginningOfWeek));
  const columns: Array<{ start: string; end: string }> = [];
  const index = new Map<string, number>();
  for (let key = columnOf(startDate); key <= endDate; key = addDays(key, mode === 'days' ? 1 : 7)) {
    const last = mode === 'days' ? key : addDays(key, 6);
    index.set(key, columns.length);
    columns.push({ start: key < startDate ? startDate : key, end: last > endDate ? endDate : last });
  }
  type Row = { id: number | null; title: string; color: string | null; cells: number[]; total: number };
  const rows = new Map<string, Row>();
  const columnTotals = columns.map(() => 0);
  let total = 0;
  for (const entry of entries) {
    const column = index.get(columnOf(entry.date));
    if (column === undefined) continue;
    const id = by === 'projects' ? entry.projectId : entry.clientId;
    let row = rows.get(String(id));
    if (!row) {
      row =
        by === 'projects'
          ? { id, title: entry.projectName ?? '', color: entry.projectColor, cells: columns.map(() => 0), total: 0 }
          : { id, title: entry.clientName ?? '', color: null, cells: columns.map(() => 0), total: 0 };
      rows.set(String(id), row);
    }
    row.cells[column]! += entry.seconds;
    row.total += entry.seconds;
    columnTotals[column]! += entry.seconds;
    total += entry.seconds;
  }
  const sorted = [...rows.values()].sort(
    (a, b) => Number(a.id === null) - Number(b.id === null) || b.total - a.total || a.title.localeCompare(b.title),
  );
  return { mode, columns, rows: sorted, columnTotals, total };
}

function keysFor(entry: ReportEntry, dimension: Dimension): GroupKey[] {
  switch (dimension) {
    case 'project':
      return [{ id: entry.projectId, title: entry.projectName ?? '', color: entry.projectColor }];
    case 'client':
      return [{ id: entry.clientId, title: entry.clientName ?? '', color: null }];
    case 'task':
      return [{ id: entry.taskId, title: entry.taskName ?? '', color: null }];
    case 'tag':
      return entry.tags.length
        ? entry.tags.map(tag => ({ id: tag.id, title: tag.name, color: null }))
        : [{ id: null, title: '', color: null }];
    case 'description':
      return [{ id: null, title: entry.description, color: null }];
    case 'none':
      return [{ id: null, title: '', color: null }];
  }
}

function groupEntries(entries: ReportEntry[], dimension: Dimension, subDimension: Dimension = 'none'): Group[] {
  const groups = new Map<string, { key: GroupKey; entries: ReportEntry[] }>();
  for (const entry of entries) {
    for (const key of keysFor(entry, dimension)) {
      const id = dimension === 'description' ? `d:${key.title}` : `i:${key.id ?? 'none'}`;
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
        entryIds: members.map(member => member.id),
        subGroups: subDimension === 'none' ? [] : groupEntries(members, subDimension),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

function v3Weekly(entries: ReportEntry[], user: OracleUser, weekStart: string) {
  const rows = new Map<string, ReturnType<typeof emptyWeeklyRow>>();
  function emptyWeeklyRow(entry: ReportEntry) {
    return {
      user_id: user.id,
      user_name: user.fullName,
      project_id: entry.projectId,
      project_name: entry.projectName,
      project_color: entry.projectColor,
      project_hex_color: entry.projectColor,
      client_name: entry.clientName,
      planned_task_id: null,
      seconds: Array<number>(7).fill(0),
      billable_seconds: Array<number>(7).fill(0),
      billable_amounts_in_cents: Array<number>(7).fill(0),
      hourly_rate_in_cents: entry.hourlyRateCents,
      currency: entry.currency,
    };
  }
  for (const entry of entries) {
    const key = String(entry.projectId ?? 'none');
    let row = rows.get(key);
    if (!row) rows.set(key, (row = emptyWeeklyRow(entry)));
    const day = daysBetween(weekStart, entry.date);
    if (day < 0 || day > 6) continue;
    row.seconds[day]! += entry.seconds;
    if (entry.billable) row.billable_seconds[day]! += entry.seconds;
    row.billable_amounts_in_cents[day]! += entry.amountCents ?? 0;
  }
  return [...rows.values()];
}

function groupJson(group: Group): unknown {
  return {
    id: group.id,
    title: group.title,
    color: group.color,
    seconds: group.seconds,
    billable_seconds: group.billableSeconds,
    amount_cents: group.amountCents,
    sub_groups: group.subGroups.map(groupJson),
  };
}

/** The answer the whole-list pipeline gives for `job` over the collected `rows`. */
export function oracleReport(
  rows: ReportEntryProjection[],
  user: OracleUser,
  workspace: OracleWorkspace,
  job: ReportJob,
): JobResult {
  const { filter } = job;
  const entries = formatEntries(rows, user, workspace, filter);
  switch (job.kind) {
    case 'v3-search': {
      const sorted = sortDetailed(entries, job.orderBy, job.orderDir);
      const { firstRow, pageSize } = job;
      const headers = rangeHeaders(filter.startDate, filter.endDate);
      if (firstRow - 1 + pageSize < sorted.length) {
        headers['X-Next-ID'] = String(sorted[firstRow - 1 + pageSize]!.id);
        headers['X-Next-Row-Number'] = String(firstRow + pageSize);
      }
      const page = sorted.slice(firstRow - 1, firstRow - 1 + pageSize);
      return json(
        page.map((entry, i) => detailedRow(entry, firstRow + i, user)),
        headers,
      );
    }
    case 'v3-totals': {
      const totals = totalsOf(entries);
      const series = timeSeries(entries, filter.startDate, filter.endDate, job.granularity, user.beginningOfWeek);
      return json(
        {
          seconds: totals.seconds,
          tracked_days: new Set(entries.map(e => e.date)).size,
          billable_amount_in_cents: totals.amounts.reduce((sum, a) => sum + a.cents, 0),
          labour_cost_in_cents: 0,
          resolution: job.granularity,
          rates: [],
          graph: job.withGraph
            ? series.map(point => ({
                seconds: point.seconds,
                billable_amount_in_cents: 0,
                labour_cost_in_cents: 0,
                by_rate: {},
              }))
            : [],
        },
        rangeHeaders(filter.startDate, filter.endDate),
      );
    }
    case 'v3-csv':
      return csv(
        detailedCsv(sortDetailed(entries, job.orderBy, job.orderDir), user, job.durationFormat),
        'Toggl_time_entries.csv',
      );
    case 'v3-summary':
      return json({
        groups: groupEntries(entries, job.grouping, job.sub).map(group =>
          summaryGroup(group, job.grouping, job.includeIds),
        ),
      });
    case 'v3-summary-csv':
      return csv(summaryCsv(groupEntries(entries, job.grouping, job.sub), job.durationFormat), 'Toggl_summary.csv');
    case 'v3-weekly':
      return json(v3Weekly(entries, user, job.weekStart), rangeHeaders(job.weekStart, filter.endDate));
    case 'app-weekly': {
      const grid = weeklyGrid(entries, filter.startDate, filter.endDate, job.rows, user.beginningOfWeek);
      return json({
        start_date: filter.startDate,
        end_date: filter.endDate,
        mode: grid.mode,
        columns: grid.columns,
        rows: grid.rows,
        column_totals: grid.columnTotals,
        total: grid.total,
      });
    }
    case 'app-report': {
      const resolution = resolutionFor(filter.startDate, filter.endDate);
      const totals = totalsOf(entries);
      return json({
        start_date: filter.startDate,
        end_date: filter.endDate,
        resolution,
        week_start: startOfWeek(filter.startDate, user.beginningOfWeek),
        totals: {
          seconds: totals.seconds,
          billable_seconds: totals.billableSeconds,
          entry_count: totals.entryCount,
          amounts: totals.amounts,
        },
        series: timeSeries(entries, filter.startDate, filter.endDate, resolution, user.beginningOfWeek).map(point => ({
          start: point.start,
          seconds: point.seconds,
          billable_seconds: point.billableSeconds,
        })),
        groups: groupEntries(entries, job.grouping, job.grouping === job.sub ? 'none' : job.sub).map(groupJson),
      });
    }
    case 'app-entries': {
      const sorted = sortDetailed(entries, job.orderBy, job.orderDir);
      const pages = Math.max(1, Math.ceil(sorted.length / job.pageSize));
      const page = Math.min(job.page, pages);
      return json({
        total: sorted.length,
        page,
        page_size: job.pageSize,
        pages,
        has_amounts: sorted.some(entry => entry.amountCents !== null),
        entries: sorted.slice((page - 1) * job.pageSize, page * job.pageSize).map(appEntry),
      });
    }
    case 'app-detailed-csv':
      return csv(
        detailedCsv(sortDetailed(entries, job.orderBy, job.orderDir), user, job.durationFormat),
        'tokkl_detailed.csv',
      );
    case 'app-summary-csv':
      return csv(
        summaryCsv(
          groupEntries(entries, job.grouping, job.grouping === job.sub ? 'none' : job.sub),
          job.durationFormat,
        ),
        'tokkl_summary.csv',
      );
  }
}
