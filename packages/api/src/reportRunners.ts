/** Keeps the storage configuration and the reader out of `services/`. */
import { Worker } from 'node:worker_threads';
import type { StorageConfig } from './storage/config.ts';
import { reportRunsInline } from './storage/repositories/report-reader.ts';
import type { JobSource } from './services/reportExecution.ts';
import { ReportRunner, type ReportRunnerOptions } from './services/reportRunner.ts';

type ReportWorkerStarter = (config: StorageConfig) => Worker;

export const startReportWorker: ReportWorkerStarter = config =>
  new Worker(new URL('./reportWorker.ts', import.meta.url), { workerData: config });

interface StorageReportRunnerOptions extends ReportRunnerOptions {
  startWorker?: ReportWorkerStarter;
}

/** In-memory SQLite, which a worker cannot open, runs jobs inline; other databases use worker threads. */
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
