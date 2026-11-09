import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { api, download } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import { detailedReportReply, reportReply, weeklyReportReply } from './replies.ts';
import type { ReportQuery } from '@tokkl/types';

/**
 * The app's report endpoints under /api/app/report. Each keeps the last result on screen while the
 * next loads. The queries are POSTs that only read, so they take the read deadline and TanStack's
 * cancel signal, like a GET. A report the filters replaced is aborted, and the server gives its
 * place in the account's report queue to the next one instead of making it wait or answer 503.
 */

/** Rows per page in the detailed report. */
export const PAGE_SIZE = 100;

/** Filter fields shared by the report endpoints and the CSV exports. */
export type ReportFilterBody = Pick<
  ReportQuery,
  | 'start_date'
  | 'end_date'
  | 'project_ids'
  | 'client_ids'
  | 'tag_ids'
  | 'billable'
  | 'description'
  | 'exclude_project_ids'
  | 'exclude_client_ids'
  | 'exclude_tag_ids'
>;

/** The report the summary and the other tabs' totals come from; `null` asks for nothing yet. */
export function reportOptions(query: ReportQuery | null) {
  return queryOptions({
    queryKey: [...keys.report, query],
    queryFn: ({ signal }) => api.post(`${APP}/report`, query, { kind: 'read', signal, decode: reportReply }),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    // The summary and the other tabs ask for different groupings; going back to the summary
    // reuses its result instead of refetching it. Edits invalidate keys.report anyway.
    staleTime: 60_000,
  });
}

export function useReport(query: ReportQuery | null) {
  return useQuery(reportOptions(query));
}

export type DetailedSort = { sort: 'date' | 'duration' | 'description'; dir: 'asc' | 'desc' };

/** One sorted page of every matching entry. */
export function detailedEntriesOptions(filters: ReportFilterBody, order: DetailedSort, page: number) {
  const body = { ...filters, ...order, page, page_size: PAGE_SIZE };
  return queryOptions({
    queryKey: [...keys.report, 'entries', body],
    queryFn: ({ signal }) =>
      api.post(`${APP}/report/entries`, body, { kind: 'read', signal, decode: detailedReportReply }),
    placeholderData: keepPreviousData,
  });
}

export function useDetailedEntries(filters: ReportFilterBody, order: DetailedSort, page: number) {
  return useQuery(detailedEntriesOptions(filters, order, page));
}

/** Totals per project or client over the whole range. */
export function weeklyReportOptions(filters: ReportFilterBody, rows: 'projects' | 'clients') {
  const body = { ...filters, rows };
  return queryOptions({
    queryKey: [...keys.report, 'weekly', body],
    queryFn: ({ signal }) =>
      api.post(`${APP}/report/weekly`, body, { kind: 'read', signal, decode: weeklyReportReply }),
    placeholderData: keepPreviousData,
  });
}

export function useWeeklyReport(filters: ReportFilterBody, rows: 'projects' | 'clients') {
  return useQuery(weeklyReportOptions(filters, rows));
}

/**
 * Downloads the detailed or summary report as CSV. `signal` cancels the download: the POST only
 * reads, so a cancelled one leaves nothing half done.
 */
export function downloadReportCsv(
  kind: 'detailed' | 'summary',
  body: object,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  return download(`${APP}/report/${kind}.csv`, filename, { method: 'POST', body, signal });
}
