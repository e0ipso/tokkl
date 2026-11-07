import type { DurationFormat } from '@tokkl/types';
import { addDays, daysBetween, startOfWeek } from '@tokkl/common/time';
import { parseSortDirection } from '../commands/reports.ts';
import type { Dimension, OrderBy, ReportFilter, SortDirection } from '../domain/reportCommands.ts';
import type { AccountExportProjection } from '../storage/domain.ts';
import { assembleCsvExport, assembleJsonExport } from './exports.ts';
import { groupEntries, resolutionFor, timeSeries, totalsOf, weeklyGrid, type Resolution } from './reportAggregates.ts';
import {
  appEntry,
  csv,
  detailedCsv,
  detailedRow,
  json,
  type JobResult,
  rangeHeaders,
  sortDetailed,
  summaryCsv,
  summaryGroup,
  v3Weekly,
} from './reportRows.ts';
import { formatReportEntries, type ReportData, type ReportEntry, type ReportUser } from './reports.ts';

/**
 * The part of each report request that reads the entries and builds the response body. The routes
 * validate the request first and pass a job here, so a job only fails on a bug. Jobs read the
 * database and nothing else, which lets them run in the report worker (see reportRunner.ts).
 */
export type ReportJob =
  | {
      kind: 'v3-search';
      filter: ReportFilter;
      orderBy: OrderBy;
      orderDir: SortDirection;
      pageSize: number;
      firstRow: number;
    }
  | { kind: 'v3-totals'; filter: ReportFilter; granularity: Resolution; withGraph: boolean }
  | { kind: 'v3-csv'; filter: ReportFilter; orderBy: OrderBy; orderDir: SortDirection; durationFormat: DurationFormat }
  | { kind: 'v3-summary'; filter: ReportFilter; grouping: Dimension; sub: Dimension; includeIds: boolean }
  | {
      kind: 'v3-summary-csv';
      filter: ReportFilter;
      grouping: Dimension;
      sub: Dimension;
      durationFormat: DurationFormat;
    }
  | { kind: 'v3-weekly'; filter: ReportFilter; weekStart: string }
  | { kind: 'app-weekly'; filter: ReportFilter; rows: 'projects' | 'clients' }
  | { kind: 'app-report'; filter: ReportFilter; grouping: Dimension; sub: Dimension }
  | {
      kind: 'app-entries';
      filter: ReportFilter;
      sort: 'date' | 'duration' | 'description';
      dir: 'asc' | 'desc';
      pageSize: number;
      page: number;
    }
  | {
      kind: 'app-detailed-csv';
      filter: ReportFilter;
      sort: 'date' | 'duration' | 'description';
      dir: 'asc' | 'desc';
      durationFormat: DurationFormat;
    }
  | {
      kind: 'app-summary-csv';
      filter: ReportFilter;
      grouping: Dimension;
      sub: Dimension;
      durationFormat: DurationFormat;
    };

export type { JobResult };

/** What every report formatter reads: the caller, the filter and the formatted entries. */
interface ReportContext {
  user: ReportUser;
  filter: ReportFilter;
  /** Formats the collected rows on first use, so a formatter that needs none pays nothing. */
  entries(): ReportEntry[];
}
type JobFormatter<K extends ReportJob['kind']> = (
  job: Extract<ReportJob, { kind: K }>,
  report: ReportContext,
) => JobResult;

/** One formatter per job kind; adding a kind without a formatter fails to compile. */
const FORMATTERS: { [K in ReportJob['kind']]: JobFormatter<K> } = {
  'v3-search': (job, { entries, user, filter }) => {
    const sorted = sortDetailed(entries(), job.orderBy, job.orderDir);
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
  },
  'v3-totals': (job, { entries, user, filter }) => {
    const list = entries();
    const totals = totalsOf(list);
    const series = timeSeries(list, filter.startDate, filter.endDate, job.granularity, user.beginningOfWeek);
    return json(
      {
        seconds: totals.seconds,
        tracked_days: new Set(list.map(e => e.date)).size,
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
  },
  'v3-csv': (job, { entries, user }) =>
    csv(
      detailedCsv(sortDetailed(entries(), job.orderBy, job.orderDir), user, job.durationFormat),
      'Toggl_time_entries.csv',
    ),
  'v3-summary': (job, { entries }) => {
    const groups = groupEntries(entries(), job.grouping, job.sub);
    return json({ groups: groups.map(group => summaryGroup(group, job.grouping, job.includeIds)) });
  },
  'v3-summary-csv': (job, { entries }) =>
    csv(summaryCsv(groupEntries(entries(), job.grouping, job.sub), job.durationFormat), 'Toggl_summary.csv'),
  'v3-weekly': (job, { entries, user, filter }) =>
    json(v3Weekly(entries(), user, job.weekStart), rangeHeaders(job.weekStart, filter.endDate)),
  'app-weekly': (job, { entries, user, filter }) => {
    const grid = weeklyGrid(entries(), filter.startDate, filter.endDate, job.rows, user.beginningOfWeek);
    return json({
      start_date: filter.startDate,
      end_date: filter.endDate,
      mode: grid.mode,
      columns: grid.columns,
      rows: grid.rows,
      column_totals: grid.columnTotals,
      total: grid.total,
    });
  },
  'app-report': (job, { entries, user, filter }) => {
    const list = entries();
    const resolution = resolutionFor(filter.startDate, filter.endDate);
    const totals = totalsOf(list);
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
      series: timeSeries(list, filter.startDate, filter.endDate, resolution, user.beginningOfWeek).map(point => ({
        start: point.start,
        seconds: point.seconds,
        billable_seconds: point.billableSeconds,
      })),
      groups: groupEntries(list, job.grouping, job.grouping === job.sub ? 'none' : job.sub).map(
        function toJson(group): unknown {
          return {
            id: group.id,
            title: group.title,
            color: group.color,
            seconds: group.seconds,
            billable_seconds: group.billableSeconds,
            amount_cents: group.amountCents,
            sub_groups: group.subGroups.map(toJson),
          };
        },
      ),
    });
  },
  'app-entries': (job, { entries }) => {
    const sorted = sortDetailed(entries(), job.sort, parseSortDirection(job.dir));
    const pages = Math.max(1, Math.ceil(sorted.length / job.pageSize));
    // A bookmarked page past the end shows the last page; the response says which page it is.
    const page = Math.min(job.page, pages);
    return json({
      total: sorted.length,
      page,
      page_size: job.pageSize,
      pages,
      has_amounts: sorted.some(entry => entry.amountCents !== null),
      entries: sorted.slice((page - 1) * job.pageSize, page * job.pageSize).map(appEntry),
    });
  },
  'app-detailed-csv': (job, { entries, user }) =>
    csv(
      detailedCsv(sortDetailed(entries(), job.sort, parseSortDirection(job.dir)), user, job.durationFormat),
      'tokkl_detailed.csv',
    ),
  'app-summary-csv': (job, { entries }) => {
    const groups = groupEntries(entries(), job.grouping, job.grouping === job.sub ? 'none' : job.sub);
    return csv(summaryCsv(groups, job.durationFormat), 'tokkl_summary.csv');
  },
};

export function formatReportJob(data: ReportData, job: ReportJob): JobResult {
  const { user, workspace } = data;
  const { filter } = job;
  let formatted: ReportEntry[] | undefined;
  const entries = () => (formatted ??= formatReportEntries(data.entries, user, workspace, filter));
  // The table is keyed by kind, so the formatter always matches the job.
  const format = FORMATTERS[job.kind] as JobFormatter<ReportJob['kind']>;
  return format(job as never, { user, filter, entries });
}

/** The v3 weekly report covers at most the seven days from its start date. */
export function v3WeeklyFilter(filter: ReportFilter): { filter: ReportFilter; weekStart: string } {
  const weekStart = filter.startDate;
  const days = Math.min(daysBetween(weekStart, filter.endDate) + 1, 7);
  return { weekStart, filter: { ...filter, endDate: addDays(weekStart, days - 1) } };
}

/** The caller collects the credential-free export projection in its own readSnapshot. */
export type ExportAssemblyJob =
  | { kind: 'export-json'; exportedAt: string; filename: string }
  | { kind: 'export-csv'; range: { from?: string; to?: string }; filename: string; durationFormat?: DurationFormat };
export function formatExportJob(data: AccountExportProjection, job: ExportAssemblyJob): JobResult {
  return {
    type: job.kind === 'export-json' ? 'json' : 'csv',
    filename: job.filename,
    headers: {},
    body:
      job.kind === 'export-json'
        ? JSON.stringify(assembleJsonExport(data, job.exportedAt))
        : assembleCsvExport(data, job.range, job.durationFormat),
  };
}
