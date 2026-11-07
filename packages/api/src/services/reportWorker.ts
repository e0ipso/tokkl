import { parentPort, workerData } from 'node:worker_threads';
import type { StorageConfig } from '../storage/config.ts';
import { openReportReader } from '../storage/repositories/report-reader.ts';
import { collectReport } from './reports.ts';
import type { ReportWork } from './reportRunner.ts';
import { formatExportJob, formatReportJob } from './reportJobs.ts';
import { ApplicationError } from '../lib/errors.ts';
import { redactedDiagnostic } from '../lib/logger.ts';

export interface ReportRequest {
  id: number;
  work: ReportWork;
}
const port = parentPort!;
try {
  const reader = await openReportReader(workerData as StorageConfig);
  let work: Promise<void> = Promise.resolve();
  port.on('message', (message: ReportRequest | { close: true }) => {
    work = work
      .then(async () => {
        if ('close' in message) {
          await reader.close();
          port.close();
          return;
        }
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
          // SQL/driver messages never leave this thread. An unexpected failure sends its redacted
          // diagnostic for the parent's log; the client still gets the fixed message.
          port.postMessage(
            error instanceof ApplicationError
              ? { id, error: { kind: error.kind, message: error.message, retryAfterSeconds: error.retryAfterSeconds } }
              : { id, error: { message: 'Report failed' }, diagnostic: redactedDiagnostic(error) },
          );
        }
      })
      .catch(async () => {
        try {
          await reader.close();
        } finally {
          port.close();
        }
      });
  });
  port.postMessage({ ready: true });
} catch (error) {
  // Startup errors can contain connection credentials, so only the redacted diagnostic is sent.
  port.postMessage({ startupFailed: redactedDiagnostic(error) });
  port.close();
}
