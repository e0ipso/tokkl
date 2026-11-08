/**
 * The jobs of the report runner's download lane: account exports and the detailed CSV reports. Each
 * writes its body through an emitter a piece at a time, at the pace the client reads it.
 */
import { runExportJob, type ExportEmitter, type ExportJobWork, type ExportRepositories } from './exportJobs.ts';
import { runCsvDownloadJob, type CsvDownloadWork } from './reportJobs.ts';
import type { ReportRepositories } from './reports.ts';

/** A job that streams its body. */
export type DownloadWork = ExportJobWork | CsvDownloadWork;

export interface DownloadSource {
  readSnapshot<T>(work: (repositories: ReportRepositories & ExportRepositories) => Promise<T>): Promise<T>;
}

/** True for a job that streams its body rather than answering it whole. */
export function isDownload(work: object): work is DownloadWork {
  return 'assembly' in work || 'download' in work;
}

/** The job's kind, for log lines. */
export function downloadKind(work: DownloadWork): string {
  return 'assembly' in work ? work.assembly.kind : work.download.kind;
}

/** Runs `work`, handing each piece of its body to `emit`. `onRows` runs once the first piece is ready. */
export function runDownloadJob(
  source: DownloadSource,
  work: DownloadWork,
  emit: ExportEmitter,
  onRows?: () => void,
): Promise<void> {
  return 'assembly' in work ? runExportJob(source, work, emit, onRows) : runCsvDownloadJob(source, work, emit, onRows);
}
