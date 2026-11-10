import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { api, download } from './client.ts';
import { object } from './decode.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import type { DetailedReportPage, Report, ReportQuery, WeeklyReport } from '@tokkl/types';

/** Report POSTs only read, so they take the read deadline and cancel signal; an aborted one frees its queue place. */

const PAGE_SIZE = 100;

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

/** `null` asks for nothing yet. */
export function reportOptions(query: ReportQuery | null) {
  return queryOptions({
    queryKey: [...keys.report, query],
    queryFn: ({ signal }) => api.post<Report>(`${APP}/report`, query, { kind: 'read', signal, decode: object }),
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

type DetailedSort = { sort: 'date' | 'duration' | 'description'; dir: 'asc' | 'desc' };

export function detailedEntriesOptions(filters: ReportFilterBody, order: DetailedSort, page: number) {
  const body = { ...filters, ...order, page, page_size: PAGE_SIZE };
  return queryOptions({
    queryKey: [...keys.report, 'entries', body],
    queryFn: ({ signal }) =>
      api.post<DetailedReportPage>(`${APP}/report/entries`, body, { kind: 'read', signal, decode: object }),
    placeholderData: keepPreviousData,
  });
}

export function useDetailedEntries(filters: ReportFilterBody, order: DetailedSort, page: number) {
  return useQuery(detailedEntriesOptions(filters, order, page));
}

export function weeklyReportOptions(filters: ReportFilterBody, rows: 'projects' | 'clients') {
  const body = { ...filters, rows };
  return queryOptions({
    queryKey: [...keys.report, 'weekly', body],
    queryFn: ({ signal }) =>
      api.post<WeeklyReport>(`${APP}/report/weekly`, body, { kind: 'read', signal, decode: object }),
    placeholderData: keepPreviousData,
  });
}

export function useWeeklyReport(filters: ReportFilterBody, rows: 'projects' | 'clients') {
  return useQuery(weeklyReportOptions(filters, rows));
}

/** The POST only reads, so a cancel leaves nothing half done. */
export function downloadReportCsv(
  kind: 'detailed' | 'summary',
  body: object,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  return download(`${APP}/report/${kind}.csv`, filename, { method: 'POST', body, signal });
}
