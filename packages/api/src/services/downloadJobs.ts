/** Each job writes its body through an emitter at the pace the client reads it. */
import { runExportJob, type ExportEmitter, type ExportJobWork, type ExportRepositories } from './exportJobs.ts';
import { runCsvDownloadJob, type CsvDownloadWork } from './reportJobs.ts';
import type { ReportRepositories } from './reports.ts';

export type DownloadWork = ExportJobWork | CsvDownloadWork;

interface DownloadSource {
  readSnapshot<T>(work: (repositories: ReportRepositories & ExportRepositories) => Promise<T>): Promise<T>;
}

export function isDownload(work: object): work is DownloadWork {
  return 'assembly' in work || 'download' in work;
}

export function downloadKind(work: DownloadWork): string {
  return 'assembly' in work ? work.assembly.kind : work.download.kind;
}

export function runDownloadJob(source: DownloadSource, work: DownloadWork, emit: ExportEmitter): Promise<void> {
  return 'assembly' in work ? runExportJob(source, work, emit) : runCsvDownloadJob(source, work, emit);
}
