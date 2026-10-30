import type { ReportFilter } from '../../../src/services/storageReports.ts';
import type { ReportJob } from '../../../src/services/storageReportJobs.ts';

export const range: ReportFilter = { startDate: '2026-10-01', endDate: '2026-10-31' };
export function jobs(filter: ReportFilter): ReportJob[] {
  return [
    { kind: 'app-report', filter, grouping: 'project', sub: 'description' },
    { kind: 'app-report', filter, grouping: 'tag', sub: 'client' },
    { kind: 'app-weekly', filter, rows: 'clients' }, { kind: 'app-weekly', filter, rows: 'projects' },
    { kind: 'app-entries', filter, sort: 'description', dir: 'asc', pageSize: 2, page: 99 },
    { kind: 'app-detailed-csv', filter, sort: 'date', dir: 'desc', durationFormat: 'decimal' },
    { kind: 'app-summary-csv', filter, grouping: 'project', sub: 'description', durationFormat: 'classic' },
    { kind: 'v3-search', filter, orderBy: 'date', orderDir: 'ASC', pageSize: 2, firstRow: 1 },
    { kind: 'v3-search', filter, orderBy: 'last_update', orderDir: 'DESC', pageSize: 2, firstRow: 2 },
    { kind: 'v3-totals', filter, granularity: 'week', withGraph: true },
    { kind: 'v3-csv', filter, orderBy: 'duration', orderDir: 'ASC', durationFormat: 'improved' },
    { kind: 'v3-summary', filter, grouping: 'project', sub: 'description', includeIds: true },
    { kind: 'v3-summary-csv', filter, grouping: 'tag', sub: 'none', durationFormat: 'classic' },
    { kind: 'v3-weekly', filter, weekStart: filter.startDate },
  ];
}
