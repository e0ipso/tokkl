import type { DurationFormat } from '@tokkl/types';
import { addDays, daysBetween, startOfWeek } from '@tokkl/common/time';
import type { DetailedOrderBy, Dimension, OrderBy, ReportFilter, SortDirection } from '../domain/reportCommands.ts';
import type { Authentication } from '../domain/credentials.ts';
import {
  grouping,
  resolutionFor,
  timeSeries,
  totals,
  weeklyGrid,
  type Aggregate,
  type Resolution,
} from './reportAggregates.ts';
import {
  appEntry,
  csv,
  detailedCsvWriter,
  detailedRow,
  json,
  type JobResult,
  rangeHeaders,
  summaryCsv,
  summaryGroup,
  v3Weekly,
} from './reportRows.ts';
import { readReport, type ReportReader, type ReportSource } from './reports.ts';

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
      orderBy: DetailedOrderBy;
      orderDir: SortDirection;
      pageSize: number;
      page: number;
    }
  | {
      kind: 'app-detailed-csv';
      filter: ReportFilter;
      orderBy: DetailedOrderBy;
      orderDir: SortDirection;
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

type JobFormatter<K extends ReportJob['kind']> = (
  job: Extract<ReportJob, { kind: K }>,
  report: ReportReader,
) => Promise<JobResult>;

/** Hands every entry, in start/id order, to each aggregate. */
const feed = (report: ReportReader, ...aggregates: Array<Aggregate<unknown>>) =>
  report.each(batch => {
    for (const entry of batch) for (const aggregate of aggregates) aggregate.add(entry);
  });

/** A sub-grouping equal to the grouping reads as none. */
const appGrouping = (job: { grouping: Dimension; sub: Dimension }) =>
  grouping(job.grouping, job.grouping === job.sub ? 'none' : job.sub);

/** One formatter per job kind; adding a kind without a formatter fails to compile. */
const FORMATTERS: { [K in ReportJob['kind']]: JobFormatter<K> } = {
  'v3-search': async (job, report) => {
    const { firstRow, pageSize } = job;
    const { user, filter } = report;
    const headers = rangeHeaders(filter.startDate, filter.endDate);
    // The rows of `slice(firstRow - 1, firstRow - 1 + pageSize)` over the sorted entries, then the
    // one at `firstRow - 1 + pageSize`, which names the next page. Lenient inputs can be fractional.
    const start = Math.trunc(firstRow - 1);
    const next = firstRow - 1 + pageSize;
    const size = Math.trunc(next) - start;
    const rows = Number.isSafeInteger(start + size)
      ? await report.page({ orderBy: job.orderBy, direction: job.orderDir }, start, size + 1)
      : [];
    if (rows.length > size) {
      // A fractional position names no entry, which has always failed the report.
      if (!Number.isInteger(next)) throw new Error('The next page starts between two rows');
      headers['X-Next-ID'] = String(rows[size]!.id);
      headers['X-Next-Row-Number'] = String(firstRow + pageSize);
    }
    return json(
      rows.slice(0, size).map((entry, i) => detailedRow(entry, firstRow + i, user)),
      headers,
    );
  },
  'v3-totals': async (job, report) => {
    const { user, filter } = report;
    const sums = totals();
    const series = timeSeries(filter.startDate, filter.endDate, job.granularity, user.beginningOfWeek);
    const days = new Set<string>();
    await report.each(batch => {
      for (const entry of batch) {
        sums.add(entry);
        series.add(entry);
        days.add(entry.date);
      }
    });
    const total = sums.result();
    return json(
      {
        seconds: total.seconds,
        tracked_days: days.size,
        billable_amount_in_cents: total.amounts.reduce((sum, a) => sum + a.cents, 0),
        labour_cost_in_cents: 0,
        resolution: job.granularity,
        rates: [],
        graph: job.withGraph
          ? series.result().map(point => ({
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
  'v3-csv': async (job, report) => {
    const writer = detailedCsvWriter(report.user, job.durationFormat);
    await report.ordered({ orderBy: job.orderBy, direction: job.orderDir }, batch => writer.add(batch));
    return csv(writer.result(), 'Toggl_time_entries.csv');
  },
  'v3-summary': async (job, report) => {
    const groups = grouping(job.grouping, job.sub);
    await feed(report, groups);
    return json({ groups: groups.result().map(group => summaryGroup(group, job.grouping, job.includeIds)) });
  },
  'v3-summary-csv': async (job, report) => {
    const groups = grouping(job.grouping, job.sub);
    await feed(report, groups);
    return csv(summaryCsv(groups.result(), job.durationFormat), 'Toggl_summary.csv');
  },
  'v3-weekly': async (job, report) => {
    const rows = v3Weekly(report.user, job.weekStart);
    await feed(report, rows);
    return json(rows.result(), rangeHeaders(job.weekStart, report.filter.endDate));
  },
  'app-weekly': async (job, report) => {
    const { user, filter } = report;
    const grid = weeklyGrid(filter.startDate, filter.endDate, job.rows, user.beginningOfWeek);
    await feed(report, grid);
    const result = grid.result();
    return json({
      start_date: filter.startDate,
      end_date: filter.endDate,
      mode: result.mode,
      columns: result.columns,
      rows: result.rows,
      column_totals: result.columnTotals,
      total: result.total,
    });
  },
  'app-report': async (job, report) => {
    const { user, filter } = report;
    const resolution = resolutionFor(filter.startDate, filter.endDate);
    const sums = totals();
    const series = timeSeries(filter.startDate, filter.endDate, resolution, user.beginningOfWeek);
    const groups = appGrouping(job);
    await feed(report, sums, series, groups);
    const total = sums.result();
    return json({
      start_date: filter.startDate,
      end_date: filter.endDate,
      resolution,
      week_start: startOfWeek(filter.startDate, user.beginningOfWeek),
      totals: {
        seconds: total.seconds,
        billable_seconds: total.billableSeconds,
        entry_count: total.entryCount,
        amounts: total.amounts,
      },
      series: series.result().map(point => ({
        start: point.start,
        seconds: point.seconds,
        billable_seconds: point.billableSeconds,
      })),
      groups: groups.result().map(function toJson(group): unknown {
        return {
          id: group.id,
          title: group.title,
          color: group.color,
          seconds: group.seconds,
          billable_seconds: group.billableSeconds,
          amount_cents: group.amountCents,
          sub_groups: group.subGroups.map(toJson),
        };
      }),
    });
  },
  'app-entries': async (job, report) => {
    const { total, hasAmounts } = await report.counts();
    const pages = Math.max(1, Math.ceil(total / job.pageSize));
    // A bookmarked page past the end shows the last page; the response says which page it is.
    const page = Math.min(job.page, pages);
    const entries = await report.page(
      { orderBy: job.orderBy, direction: job.orderDir },
      (page - 1) * job.pageSize,
      job.pageSize,
    );
    return json({
      total,
      page,
      page_size: job.pageSize,
      pages,
      has_amounts: hasAmounts,
      entries: entries.map(appEntry),
    });
  },
  'app-detailed-csv': async (job, report) => {
    const writer = detailedCsvWriter(report.user, job.durationFormat);
    await report.ordered({ orderBy: job.orderBy, direction: job.orderDir }, batch => writer.add(batch));
    return csv(writer.result(), 'tokkl_detailed.csv');
  },
  'app-summary-csv': async (job, report) => {
    const groups = appGrouping(job);
    await feed(report, groups);
    return csv(summaryCsv(groups.result(), job.durationFormat), 'tokkl_summary.csv');
  },
};

/** A report job and whose entries it reads. */
export interface ReportJobWork {
  userId: number;
  workspaceId: number;
  job: ReportJob;
  authentication?: Authentication;
}

/**
 * Reads and formats `work` in one read snapshot, a batch of entries at a time. `onRows` runs once,
 * when the first entries arrive and formatting begins.
 */
export function runReportJob(source: ReportSource, work: ReportJobWork, onRows?: () => void): Promise<JobResult> {
  const { userId, workspaceId, job, authentication } = work;
  // The table is keyed by kind, so the formatter always matches the job.
  const format = FORMATTERS[job.kind] as JobFormatter<ReportJob['kind']>;
  return readReport(source, userId, workspaceId, job.filter, { authentication, onRows }, report =>
    format(job as never, report),
  );
}

/** The v3 weekly report covers at most the seven days from its start date. */
export function v3WeeklyFilter(filter: ReportFilter): { filter: ReportFilter; weekStart: string } {
  const weekStart = filter.startDate;
  const days = Math.min(daysBetween(weekStart, filter.endDate) + 1, 7);
  return { weekStart, filter: { ...filter, endDate: addDays(weekStart, days - 1) } };
}
