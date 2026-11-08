import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, download } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import { detailedReportReply, reportReply, weeklyReportReply } from './replies.ts';
import type { ReportQuery } from './types.ts';

/**
 * The app's report endpoints under /api/app/report. Each keeps the last result on screen while the
 * next loads. The queries are POSTs that only read, so they take the read deadline. They do not
 * take TanStack's cancel signal: the app cancels GETs alone, so an aborted POST always means a
 * write that may or may not have landed, here and in the e2e error guard.
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

export function useReport(query: ReportQuery | null) {
  return useQuery({
    queryKey: [...keys.report, query],
    queryFn: () => api.post(`${APP}/report`, query, { kind: 'read', decode: reportReply }),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    // The summary and the other tabs ask for different groupings; going back to the summary
    // reuses its result instead of refetching it. Edits invalidate keys.report anyway.
    staleTime: 60_000,
  });
}

export type DetailedSort = { sort: 'date' | 'duration' | 'description'; dir: 'asc' | 'desc' };

/** One sorted page of every matching entry. */
export function useDetailedEntries(filters: ReportFilterBody, order: DetailedSort, page: number) {
  const body = { ...filters, ...order, page, page_size: PAGE_SIZE };
  return useQuery({
    queryKey: [...keys.report, 'entries', body],
    queryFn: () => api.post(`${APP}/report/entries`, body, { kind: 'read', decode: detailedReportReply }),
    placeholderData: keepPreviousData,
  });
}

/** Totals per project or client over the whole range. */
export function useWeeklyReport(filters: ReportFilterBody, rows: 'projects' | 'clients') {
  const body = { ...filters, rows };
  return useQuery({
    queryKey: [...keys.report, 'weekly', body],
    queryFn: () => api.post(`${APP}/report/weekly`, body, { kind: 'read', decode: weeklyReportReply }),
    placeholderData: keepPreviousData,
  });
}

/** Downloads the detailed or summary report as CSV. */
export function downloadReportCsv(kind: 'detailed' | 'summary', body: object, filename: string): Promise<void> {
  return download(`${APP}/report/${kind}.csv`, filename, { method: 'POST', body });
}
