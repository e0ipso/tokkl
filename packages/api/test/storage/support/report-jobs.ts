import type { ReportFilter } from '../../../src/domain/reportCommands.ts';
import {
  CSV_DOWNLOAD_FILENAMES,
  runCsvDownloadJob,
  runReportJob,
  type CsvDownloadJob,
  type JobResult,
  type ReportJob,
} from '../../../src/services/reportJobs.ts';
import type { ReportExecutor } from '../../../src/services/reportRunner.ts';
import type { ReportSource } from '../../../src/services/reports.ts';

/** A report answered whole, or a detailed CSV that streams. */
export type AnyReportJob = ReportJob | CsvDownloadJob;

export const isCsvDownload = (job: AnyReportJob): job is CsvDownloadJob => job.kind in CSV_DOWNLOAD_FILENAMES;

/** The whole answer a detailed CSV gave before it streamed: its pieces joined. */
const csvResult = (job: CsvDownloadJob, chunks: string[]): JobResult => ({
  type: 'csv',
  body: chunks.join(''),
  filename: CSV_DOWNLOAD_FILENAMES[job.kind],
  headers: {},
});

/** Answers `job` from `source`, joining a streamed CSV into one result. */
export async function answerJob(
  source: ReportSource,
  work: { userId: number; workspaceId: number; job: AnyReportJob },
): Promise<JobResult> {
  const { userId, workspaceId, job } = work;
  if (!isCsvDownload(job)) return runReportJob(source, { userId, workspaceId, job });
  const chunks: string[] = [];
  await runCsvDownloadJob(source, { userId, workspaceId, download: job }, async chunk => {
    chunks.push(chunk);
  });
  return csvResult(job, chunks);
}

/** Answers `job` on `runner`: a report in its report lane, a detailed CSV in its download lane. */
export async function answerOnRunner(
  runner: ReportExecutor,
  userId: number,
  workspaceId: number,
  job: AnyReportJob,
): Promise<JobResult> {
  if (!isCsvDownload(job)) return runner.reserve({ userId }, slot => slot.run(userId, workspaceId, job));
  const chunks: string[] = [];
  await runner.reserveDownload({ userId }, slot =>
    slot.report(userId, workspaceId, job, async chunk => {
      chunks.push(chunk);
    }),
  );
  return csvResult(job, chunks);
}

export const range: ReportFilter = { startDate: '2026-10-01', endDate: '2026-10-31' };
export function jobs(filter: ReportFilter): AnyReportJob[] {
  return [
    { kind: 'app-report', filter, grouping: 'project', sub: 'description' },
    { kind: 'app-report', filter, grouping: 'tag', sub: 'client' },
    { kind: 'app-weekly', filter, rows: 'clients' },
    { kind: 'app-weekly', filter, rows: 'projects' },
    { kind: 'app-entries', filter, orderBy: 'description', orderDir: 'ASC', pageSize: 2, page: 99 },
    { kind: 'app-detailed-csv', filter, orderBy: 'date', orderDir: 'DESC', durationFormat: 'decimal' },
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
