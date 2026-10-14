// Worker thread for reportRunner.ts: builds report responses on its own read-only connection, so
// the main thread keeps answering timer and entry requests while a large report is built.
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { HttpError } from '../lib/errors.ts';
import type { UserRow } from '../models/users.ts';
import type { WorkspaceRow } from '../models/workspaces.ts';
import { runJob, type ReportJob } from './reportJobs.ts';

export interface JobMessage {
  id: number;
  user: UserRow;
  ws: WorkspaceRow;
  job: ReportJob;
}

const db = new DatabaseSync((workerData as { path: string }).path, { readOnly: true, timeout: 5000 });

parentPort!.on('message', ({ id, user, ws, job }: JobMessage) => {
  try {
    parentPort!.postMessage({ id, result: runJob(db, user, ws, job) });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    parentPort!.postMessage({
      id,
      error: { name: err.name, message: err.message, stack: err.stack, status: error instanceof HttpError ? error.status : undefined },
    });
  }
});
