import { Worker } from 'node:worker_threads';
import type { Db } from '../db/index.ts';
import { HttpError } from '../lib/errors.ts';
import type { UserRow } from '../models/users.ts';
import type { WorkspaceRow } from '../models/workspaces.ts';
import { runJob, type JobResult, type ReportJob } from './reportJobs.ts';

interface WorkerError { name: string; message: string; stack?: string; status?: number }
interface Pending { worker: Worker; resolve: (result: JobResult) => void; reject: (error: Error) => void }

function revive(error: WorkerError): Error {
  // Keep the error types the app's error handler maps to 400 and 4xx responses.
  const revived = error.status !== undefined ? new HttpError(error.status, error.message)
    : error.name === 'RangeError' ? new RangeError(error.message) : new Error(error.message);
  if (error.stack) revived.stack = error.stack;
  return revived;
}

/**
 * Builds report responses off the main thread. Building a whole-history report or CSV takes
 * seconds on a large database, and doing it on the main thread held every other request, the
 * timer included, until it finished. One worker thread opens the same SQLite file read-only and
 * takes jobs one at a time; WAL mode lets it read while the main thread writes.
 *
 * An in-memory database exists only on its own connection, so a worker cannot open it; those jobs
 * run inline on the main thread, with the same code.
 */
export class ReportRunner {
  private readonly db: Db;
  private readonly path: string | null;
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(db: Db) {
    this.db = db;
    this.path = db.location();
  }

  run(user: UserRow, ws: WorkspaceRow, job: ReportJob): Promise<JobResult> {
    if (this.path === null) {
      try {
        return Promise.resolve(runJob(this.db, user, ws, job));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const worker = this.worker ?? this.startWorker(this.path);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { worker, resolve, reject });
      worker.postMessage({ id, user, ws, job });
    });
  }

  private startWorker(path: string): Worker {
    const worker = new Worker(new URL('./reportWorker.ts', import.meta.url), { workerData: { path } });
    // An idle worker must not keep the process alive after the HTTP server closes.
    worker.unref();
    worker.on('message', (message: { id: number; result?: JobResult; error?: WorkerError }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(revive(message.error));
      else pending.resolve(message.result!);
    });
    // A crashed worker fails only its own jobs; the next job starts a new worker.
    const fail = (error: Error) => {
      if (this.worker === worker) this.worker = null;
      for (const [id, pending] of this.pending) {
        if (pending.worker !== worker) continue;
        this.pending.delete(id);
        pending.reject(error);
      }
    };
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`The report worker stopped with exit code ${code}`)));
    this.worker = worker;
    return worker;
  }
}

const runners = new WeakMap<Db, ReportRunner>();

/** The runner for a database, shared by every report route that uses it. */
export function reportRunner(db: Db): ReportRunner {
  let runner = runners.get(db);
  if (!runner) runners.set(db, (runner = new ReportRunner(db)));
  return runner;
}
