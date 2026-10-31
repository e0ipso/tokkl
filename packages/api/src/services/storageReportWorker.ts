import { parentPort, workerData } from 'node:worker_threads';
import type { StorageConfig } from '../storage/config.ts';
import { openReportReader } from '../storage/repositories/report-reader.ts';
import { collectReport } from './storageReports.ts';
import type { ReportWork } from './storageReportRunner.ts';
import { formatExportJob, formatReportJob } from './storageReportJobs.ts';
import { HttpError } from '../lib/errors.ts';

export interface ReportRequest { id: number; work: ReportWork }
const port = parentPort!;
try {
  const reader = await openReportReader(workerData as StorageConfig);
  let work: Promise<void> = Promise.resolve();
  port.on('message', (message: ReportRequest | { close: true }) => {
    work = work.then(async () => {
      if ('close' in message) { await reader.close(); port.close(); return; }
      const { id, work } = message;
      try {
        if ('assembly' in work) {
          port.postMessage({ id, phase: 'formatting' });
          port.postMessage({ id, result: formatExportJob(work.data, work.assembly) });
          return;
        }
        const { userId, workspaceId, job, authentication } = work;
        port.postMessage({ id, phase: 'reading' });
        const data = await collectReport(reader, userId, workspaceId, job.filter, authentication);
        port.postMessage({ id, phase: 'formatting' });
        port.postMessage({ id, result: formatReportJob(data, job) });
      } catch (error) {
        // SQL/driver errors and stacks never leave this thread.
        port.postMessage({ id, error: error instanceof HttpError ? { status: error.status, message: error.message } : { message: 'Report failed' } });
      }
    }).catch(async () => { try { await reader.close(); } finally { port.close(); } });
  });
  port.postMessage({ ready: true });
} catch {
  // Startup errors can contain connection credentials. Report a fixed failure only.
  port.close();
}
