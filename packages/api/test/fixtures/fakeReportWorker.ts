/**
 * Record posted jobs and settle them only when the test says so, speaking the runner's side of the worker
 * protocol, so lane scheduling is tested without threads or a database.
 */
import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import type { ReportWork, WorkerStarter } from '../../src/services/reportExecution.ts';
import type { JobResult } from '../../src/services/reportJobs.ts';

export interface PostedJob {
  id: number;
  work: ReportWork;
  worker: FakeReportWorker;
}

export class FakeReportWorker extends EventEmitter {
  terminated = false;
  readonly #posted: (job: PostedJob) => void;
  constructor(posted: (job: PostedJob) => void) {
    super();
    this.#posted = posted;
    setImmediate(() => this.emit('message', { ready: true }));
  }
  postMessage(message: { id?: number; work?: ReportWork; close?: boolean }): void {
    if (message.close) setImmediate(() => this.emit('exit', 0));
    else if (message.work && message.id !== undefined)
      this.#posted({ id: message.id, work: message.work, worker: this });
  }
  ref(): void {}
  unref(): void {}
  terminate(): Promise<number> {
    this.terminated = true;
    setImmediate(() => this.emit('exit', 1));
    return Promise.resolve(1);
  }
  finish(id: number, result: JobResult = { type: 'json', body: '{}', headers: {} } as never): void {
    this.emit('message', { id, result });
  }
}

export function fakeReportWorkers() {
  const workers: FakeReportWorker[] = [];
  const posted: PostedJob[] = [];
  const startWorker: WorkerStarter = () => {
    const worker = new FakeReportWorker(job => posted.push(job));
    workers.push(worker);
    return worker as unknown as Worker;
  };
  return { startWorker, workers, posted };
}

/** Fails after a second without them. */
export async function postedJobs(posted: PostedJob[], count: number): Promise<PostedJob[]> {
  const deadline = Date.now() + 1000;
  while (posted.length < count) {
    if (Date.now() > deadline) throw new Error(`${posted.length} jobs posted, not ${count}`);
    await new Promise(resolve => setImmediate(resolve));
  }
  return posted;
}
