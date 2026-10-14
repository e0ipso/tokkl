import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys } from '../../api/hooks.ts';
import type { ReportEntry } from '../../api/types.ts';
import type { ReportFilterBody } from './query.ts';
import type { SortDir, SortKey, WeeklyRows } from './urlState.ts';

/** Rows per page in the detailed report. */
export const PAGE_SIZE = 100;

/** POST /api/app/report/entries: one sorted page of every matching entry. */
export interface DetailedPage {
  total: number;
  /** The page served, which is the last page when the requested one is past the end. */
  page: number;
  page_size: number;
  pages: number;
  /** Whether any matching entry, on any page, has a billable amount. */
  has_amounts: boolean;
  entries: ReportEntry[];
}

export function useDetailedEntries(filters: ReportFilterBody, sort: SortKey, dir: SortDir, page: number) {
  const body = { ...filters, sort, dir, page, page_size: PAGE_SIZE };
  return useQuery({
    queryKey: [...keys.report, 'entries', body],
    queryFn: () => api.post<DetailedPage>('/api/app/report/entries', body),
    placeholderData: (previous) => previous,
  });
}

/** POST /api/app/report/weekly: totals per project or client over the whole range. */
export interface WeeklyReport {
  start_date: string;
  end_date: string;
  mode: 'days' | 'weeks';
  columns: Array<{ start: string; end: string }>;
  rows: Array<{ id: number | null; title: string; color: string | null; cells: number[]; total: number }>;
  column_totals: number[];
  total: number;
}

export function useWeeklyReport(filters: ReportFilterBody, rows: WeeklyRows) {
  const body = { ...filters, rows };
  return useQuery({
    queryKey: [...keys.report, 'weekly', body],
    queryFn: () => api.post<WeeklyReport>('/api/app/report/weekly', body),
    placeholderData: (previous) => previous,
  });
}
