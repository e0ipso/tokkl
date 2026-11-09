/**
 * Builds the report runner for a storage configuration: it picks where the jobs run and how a
 * worker thread starts, so `services/` never sees the configuration or the reader it opens.
 */
import { Worker } from 'node:worker_threads';
import type { StorageConfig } from './storage/config.ts';
import { reportRunsInline } from './storage/repositories/report-reader.ts';
import type { JobSource } from './services/reportExecution.ts';
import { ReportRunner, type ReportRunnerOptions } from './services/reportRunner.ts';

/** Starts a report worker thread, which opens its own reader for `config`. */
type ReportWorkerStarter = (config: StorageConfig) => Worker;

/** The worker every report runner starts unless it is given another starter. */
export const startReportWorker: ReportWorkerStarter = config =>
  new Worker(new URL('./reportWorker.ts', import.meta.url), { workerData: config });

interface StorageReportRunnerOptions extends ReportRunnerOptions {
  /** How the runner starts its worker threads. Defaults to `startReportWorker`. */
  startWorker?: ReportWorkerStarter;
}

/**
 * A runner for `config`. In-memory SQLite, which a worker cannot open, runs the jobs one at a time
 * on `inline`, the application's own connection; every other database runs them in worker threads.
 */
export function createReportRunner(
  config: StorageConfig,
  inline: JobSource,
  { startWorker = startReportWorker, ...options }: StorageReportRunnerOptions = {},
): ReportRunner {
  return new ReportRunner(
    reportRunsInline(config) ? { inline } : { startWorker: () => startWorker(structuredClone(config)) },
    options,
  );
}
