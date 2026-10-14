import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys } from '../../api/hooks.ts';
import type { ReportFilterBody } from './query.ts';
import type { WeeklyRows } from './urlState.ts';

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
