import { Worker } from 'node:worker_threads';
import type { StorageConfig } from '../storage/config.ts';
import { reportRunsInline } from '../storage/repositories/report-reader.ts';
import { ApplicationError, RequestCancelled, unavailable, type FailureKind } from '../lib/errors.ts';
import { redactedDiagnostic, silentLogger, type ErrorDiagnostic, type Logger } from '../lib/logger.ts';
import { collectReport, type ReportSource } from './reports.ts';
import type { AccountExportProjection, User } from '../storage/domain.ts';
import type { Authentication } from '../domain/credentials.ts';
import {
  formatExportJob,
  formatReportJob,
  type ExportAssemblyJob,
  type JobResult,
  type ReportJob,
} from './reportJobs.ts';

/** A queued report usually finishes within a second or two, so a full queue asks for a short wait. */
const QUEUE_FULL_RETRY_SECONDS = 2;
const DEFAULT_MAX_QUEUE = 16;
const MAX_QUEUE_LIMIT = 100;

export interface ReportRunnerOptions {
  /** Includes the active job; overload fails immediately. Default 16, maximum 100. */
  maxQueue?: number;
  onPhase?: (phase: 'reading' | 'formatting') => void;
  /** Where unexpected report and worker failures are logged, as redacted diagnostics. */
  logger?: Logger;
}
interface Pending {
  id: number;
  work: ReportWork;
  resolve(result: JobResult): void;
  reject(error: Error): void;
  dispose(): void;
}
export type ReportWork =
  | { userId: number; workspaceId: number; job: ReportJob; authentication?: Authentication }
  | { data: AccountExportProjection; assembly: ExportAssemblyJob };
interface Reply {
  id?: number;
  ready?: boolean;
  phase?: 'reading' | 'formatting';
  result?: JobResult;
  /** An application failure keeps its kind and message; anything else arrives without a kind. */
  error?: { kind?: FailureKind; message: string; retryAfterSeconds?: number };
  /** Sent with an unexpected failure, for the log only. */
  diagnostic?: ErrorDiagnostic;
  /** The worker could not open its reader. */
  startupFailed?: ErrorDiagnostic;
}

/**
 * What the application needs from a report runner: queue a report or an export assembly, and shut
 * down. The composition root builds the runner and hands this to the application services.
 */
export interface ReportExecutor {
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options?: { signal?: AbortSignal; authentication?: Authentication },
  ): Promise<JobResult>;
  assembleExport(
    data: AccountExportProjection,
    assembly: ExportAssemblyJob,
    options?: { signal?: AbortSignal },
  ): Promise<JobResult>;
  /** Fails every queued job and stops the worker. */
  close(): Promise<void>;
}

/** The job's kind and the runner's id for it: what a log line may say about a job. */
function jobFields(p: Pending) {
  return { jobId: p.id, jobKind: 'assembly' in p.work ? p.work.assembly.kind : p.work.job.kind };
}

/** One runner per app, one worker/reader, a bounded parent queue and one job in flight. */
export class ReportRunner implements ReportExecutor {
  private readonly config: StorageConfig;
  private readonly inline: ReportSource;
  private readonly options: ReportRunnerOptions;
  private readonly maxQueue: number;
  private readonly logger: Logger;
  private worker: Worker | null = null;
  private ready = false;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private active: Pending | undefined;
  private queue: Pending[] = [];
  private nextId = 1;
  private closed = false;
  private stopping: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private inlineWork: Promise<void> | undefined;

  constructor(config: StorageConfig, inline: ReportSource, options: ReportRunnerOptions = {}) {
    this.config = structuredClone(config);
    this.inline = inline;
    this.options = options;
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.logger = options.logger ?? silentLogger;
    if (!Number.isSafeInteger(this.maxQueue) || this.maxQueue < 1 || this.maxQueue > MAX_QUEUE_LIMIT)
      throw new Error('Invalid report queue limit');
  }
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options: { signal?: AbortSignal; authentication?: Authentication } = {},
  ): Promise<JobResult> {
    return this.enqueue({ userId, workspaceId, job, authentication: options.authentication }, options);
  }
  assembleExport(
    data: AccountExportProjection,
    assembly: ExportAssemblyJob,
    options: { signal?: AbortSignal } = {},
  ): Promise<JobResult> {
    // Structural typing permits a full User where the credential-free view was expected.
    const projection = { ...data, user: { ...data.user } };
    delete (projection.user as Partial<User>).passwordHash;
    delete (projection.user as Partial<User>).apiToken;
    return this.enqueue({ data: projection, assembly }, options);
  }
  private enqueue(work: ReportWork, options: { signal?: AbortSignal }): Promise<JobResult> {
    if (this.closed) return Promise.reject(new Error('Report runner is closed'));
    if (options.signal?.aborted) return Promise.reject(new RequestCancelled('Report cancelled'));
    if (this.queue.length + Number(!!this.active) >= this.maxQueue)
      return Promise.reject(unavailable('Report queue is full', QUEUE_FULL_RETRY_SECONDS));
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        id: this.nextId++,
        work: structuredClone(work),
        resolve,
        reject,
        dispose: () => options.signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        if (this.active === pending) {
          this.active = undefined;
          pending.dispose();
          pending.reject(new RequestCancelled('Report cancelled'));
          if (this.worker) this.stopWorker();
        } else {
          this.queue = this.queue.filter(p => p !== pending);
          pending.dispose();
          pending.reject(new RequestCancelled('Report cancelled'));
        }
        this.pump();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(pending);
      this.pump();
    });
  }
  private pump(): void {
    if (this.closed || this.active || this.stopping || this.inlineWork || !this.queue.length) return;
    if (reportRunsInline(this.config)) {
      const p = this.queue.shift()!;
      this.active = p;
      const work = p.work;
      const build =
        'assembly' in work
          ? Promise.resolve().then(() => formatExportJob(work.data, work.assembly))
          : collectReport(this.inline, work.userId, work.workspaceId, work.job.filter, work.authentication).then(data =>
              formatReportJob(data, work.job),
            );
      this.inlineWork = build
        .then(result => {
          if (this.active === p) this.finish(p, result);
        })
        .catch(error => {
          if (this.active !== p) return;
          if (!(error instanceof ApplicationError))
            this.logger.error('Report failed', { ...jobFields(p), diagnostic: redactedDiagnostic(error) });
          this.finish(p, undefined, this.safeError(error));
        })
        .finally(() => {
          this.inlineWork = undefined;
          this.pump();
        });
      return;
    }
    if (!this.worker) this.startWorker();
    if (!this.ready) return;
    const p = this.queue.shift()!;
    this.active = p;
    this.worker!.ref();
    this.worker!.postMessage({ id: p.id, work: p.work });
  }
  private safeError(error: unknown): Error {
    return error instanceof ApplicationError ? error : new Error('Report failed');
  }
  private finish(p: Pending, result?: JobResult, error?: Error): void {
    this.active = undefined;
    p.dispose();
    if (error) p.reject(error);
    else p.resolve(result!);
    this.worker?.unref();
    this.pump();
  }
  private startWorker(): void {
    const worker = new Worker(new URL('./reportWorker.ts', import.meta.url), { workerData: this.config });
    this.worker = worker;
    const fail = () => {
      if (this.worker !== worker) return;
      this.ready = false;
      clearTimeout(this.startup);
      // Wait for this worker's exit before allowing a replacement reader to open.
      this.stopWorker();
      const error = new Error('Report worker stopped');
      if (this.active) {
        const p = this.active;
        this.active = undefined;
        p.dispose();
        p.reject(error);
      }
      for (const p of this.queue.splice(0)) {
        p.dispose();
        p.reject(error);
      }
    };
    worker.on('message', (message: Reply) => {
      if (this.worker !== worker) return;
      if (message.startupFailed) {
        this.logger.error('Report worker failed to start', { diagnostic: message.startupFailed });
        return;
      }
      if (message.ready) {
        clearTimeout(this.startup);
        this.ready = true;
        if (!this.queue.length) worker.unref();
        this.pump();
        return;
      }
      const p = this.active;
      if (!p || message.id !== p.id) return;
      if (message.phase) {
        try {
          this.options.onPhase?.(message.phase);
        } catch {
          /* Observers do not own jobs. */
        }
        return;
      }
      if (message.diagnostic) this.logger.error('Report failed', { ...jobFields(p), diagnostic: message.diagnostic });
      this.finish(
        p,
        message.result,
        message.error
          ? message.error.kind === undefined
            ? new Error('Report failed')
            : new ApplicationError(message.error.kind, message.error.message, message.error.retryAfterSeconds)
          : undefined,
      );
    });
    worker.on('error', error => {
      if (this.worker === worker)
        this.logger.error('Report worker crashed', {
          ...(this.active && jobFields(this.active)),
          diagnostic: redactedDiagnostic(error),
        });
      fail();
    });
    worker.on('exit', fail);
    this.startup = setTimeout(() => {
      if (this.worker === worker) this.logger.error('Report worker did not start in time');
      fail();
    }, 30000);
  }
  private stopWorker(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.ready = false;
    clearTimeout(this.startup);
    this.stopping = worker
      .terminate()
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.stopping = undefined;
        this.pump();
      });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const error = new Error('Report runner is closed');
    if (this.active) {
      const p = this.active;
      this.active = undefined;
      p.dispose();
      p.reject(error);
    }
    for (const p of this.queue.splice(0)) {
      p.dispose();
      p.reject(error);
    }
    this.closing = (async () => {
      clearTimeout(this.startup);
      if (this.inlineWork) await this.inlineWork;
      if (this.stopping) await this.stopping;
      const worker = this.worker;
      if (!worker) return;
      this.worker = null;
      worker.ref();
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          void worker.terminate();
        }, 30000);
        worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        worker.postMessage({ close: true });
      });
    })();
    return this.closing;
  }
}
