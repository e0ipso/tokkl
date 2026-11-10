/** Each reserves a place for `userId` and queues one job in it, as a route does in two steps. */
import type { Authentication } from '../../src/domain/credentials.ts';
import type { ExportAssemblyJob, ExportEmitter } from '../../src/services/exportJobs.ts';
import type { JobResult, ReportJob } from '../../src/services/reportJobs.ts';
import type { ReportExecutor } from '../../src/services/reportRunner.ts';

interface RunOptions {
  signal?: AbortSignal;
  authentication?: Authentication;
}

export function runReport(
  runner: ReportExecutor,
  userId: number,
  workspaceId: number,
  job: ReportJob,
  options: RunOptions = {},
): Promise<JobResult> {
  return runner.reserve({ userId, signal: options.signal }, slot => slot.run(workspaceId, job, options));
}

export function runExport(
  runner: ReportExecutor,
  userId: number,
  assembly: ExportAssemblyJob,
  output: ExportEmitter,
  options: RunOptions = {},
): Promise<void> {
  return runner.reserveDownload({ userId, signal: options.signal }, slot => slot.export(assembly, output, options));
}
