import type { Worker } from 'node:worker_threads';
import type { StorageConfig } from '../../../src/storage/config.ts';
import { startReportWorker } from '../../../src/reportRunners.ts';

/** Keeps each real worker it started, oldest first, so a test can watch, hold or stop it. */
export function trackedWorkers() {
  const started: Worker[] = [];
  return {
    started,
    latest: (): Worker => {
      const worker = started.at(-1);
      if (!worker) throw new Error('No report worker started');
      return worker;
    },
    startWorker: (config: StorageConfig): Worker => {
      const worker = startReportWorker(config);
      started.push(worker);
      return worker;
    },
  };
}
