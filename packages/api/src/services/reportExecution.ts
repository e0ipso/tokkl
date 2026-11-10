/** Runs one job at a time, in the report worker or inline for in-memory SQLite; `reportRunner.ts` owns queues. */
import type { Worker } from 'node:worker_threads';
import { ApplicationError, RequestCancelled, type FailureKind } from '../lib/errors.ts';
import { redactedDiagnostic, type ErrorDiagnostic, type Logger } from '../lib/logger.ts';
import type { ReportRepositories } from './reports.ts';
import type { ExportEmitter, ExportRepositories } from './exportJobs.ts';
import { downloadKind, isDownload, runDownloadJob, type DownloadWork } from './downloadJobs.ts';
import { runReportJob, type JobResult, type ReportJobWork } from './reportJobs.ts';

export type ReportWork = ReportJobWork | DownloadWork;

export interface JobSource {
  readSnapshot<T>(work: (repositories: ReportRepositories & ExportRepositories) => Promise<T>): Promise<T>;
}

export interface ExecutionJob {
  id: number;
  work: ReportWork;
  /** Pieces go in order; each resolves once the next may follow. */
  output?: ExportEmitter;
}

interface ExecutionEvents {
  /** `error` is safe to show the client. An export ends without a result once every piece was taken. */
  settled(id: number, result?: JobResult, error?: Error): void;
  /** After it started, stopped or finished one. */
  available(): void;
  /** The running job and every queued one fail with `error`. */
  failed(error: Error): void;
}

export interface ReportExecution {
  /** The first call starts the worker; `available` follows once it is up. */
  ready(): boolean;
  run(job: ExecutionJob): void;
  /** Its outcome is never reported, and a worker running it stops. */
  cancel(): void;
  /** Resolves once the running job's snapshot and the worker are released. */
  close(): Promise<void>;
}

export type WorkerStarter = () => Worker;

/** Inline when the database is one a worker cannot open. */
export type ReportPlacement = { startWorker: WorkerStarter } | { inline: JobSource };

interface Reply {
  id?: number;
  ready?: boolean;
  /** Acknowledged by its size in UTF-8 bytes. */
  chunk?: string;
  bytes?: number;
  result?: JobResult;
  /** An application failure keeps its kind and message; anything else arrives without a kind. */
  error?: { kind?: FailureKind; message: string; retryAfterSeconds?: number };
  /** For the log only. */
  diagnostic?: ErrorDiagnostic;
  startupFailed?: ErrorDiagnostic;
}

/** What a log line may say about a job. */
function jobFields(job: ExecutionJob) {
  return { jobId: job.id, jobKind: isDownload(job.work) ? downloadKind(job.work) : job.work.job.kind };
}

const safeError = (error: unknown): Error => (error instanceof ApplicationError ? error : new Error('Report failed'));

/** For opening the worker's reader, and closing it on shutdown. */
const WORKER_DEADLINE_MS = 30000;

/** For in-memory SQLite, which a worker cannot open. */
class InlineExecution implements ReportExecution {
  private readonly source: JobSource;
  private readonly events: ExecutionEvents;
  private readonly logger: Logger;
  private current: ExecutionJob | undefined;
  /** Held until the snapshot is released, even after a cancel. */
  private work: Promise<void> | undefined;

  constructor(source: JobSource, events: ExecutionEvents, logger: Logger) {
    this.source = source;
    this.events = events;
    this.logger = logger;
  }
  ready(): boolean {
    return !this.work;
  }
  run(job: ExecutionJob): void {
    this.current = job;
    const { work } = job;
    // A cancelled download stops at its next piece, which releases the snapshot.
    const output: ExportEmitter = chunk =>
      this.current === job ? job.output!(chunk) : Promise.reject(new RequestCancelled('Report cancelled'));
    const build: Promise<JobResult | undefined> = isDownload(work)
      ? runDownloadJob(this.source, work, output).then(() => undefined)
      : runReportJob(this.source, work);
    this.work = build
      .then(result => {
        if (this.current !== job) return;
        this.current = undefined;
        this.events.settled(job.id, result);
      })
      .catch(error => {
        if (this.current !== job) return;
        this.current = undefined;
        if (!(error instanceof ApplicationError))
          this.logger.error('Report failed', { ...jobFields(job), diagnostic: redactedDiagnostic(error) });
        this.events.settled(job.id, undefined, safeError(error));
      })
      .finally(() => {
        this.work = undefined;
        this.events.available();
      });
  }
  cancel(): void {
    this.current = undefined;
  }
  async close(): Promise<void> {
    this.current = undefined;
    if (this.work) await this.work;
  }
}

/** A worker that crashes, exits or fails to start fails every job; a fresh one starts after the old one exited. */
class WorkerExecution implements ReportExecution {
  private worker: Worker | null = null;
  private readonly startWorker: WorkerStarter;
  private readonly events: ExecutionEvents;
  private readonly logger: Logger;
  private started = false;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private current: ExecutionJob | undefined;
  /** No replacement opens its reader until this resolves. */
  private stopping: Promise<void> | undefined;

  constructor(startWorker: WorkerStarter, events: ExecutionEvents, logger: Logger) {
    this.startWorker = startWorker;
    this.events = events;
    this.logger = logger;
  }
  ready(): boolean {
    if (this.stopping) return false;
    if (!this.worker) this.start();
    return this.started;
  }
  run(job: ExecutionJob): void {
    this.current = job;
    this.worker!.ref();
    this.worker!.postMessage({ id: job.id, work: job.work });
  }
  cancel(): void {
    this.current = undefined;
    if (this.worker) this.stop();
  }
  private start(): void {
    const worker = this.startWorker();
    this.worker = worker;
    const fail = () => {
      if (this.worker !== worker) return;
      this.stop();
      this.current = undefined;
      this.events.failed(new Error('Report worker stopped'));
    };
    worker.on('message', (message: Reply) => {
      if (this.worker === worker) this.receive(worker, message);
    });
    worker.on('error', error => {
      if (this.worker === worker)
        this.logger.error('Report worker crashed', {
          ...(this.current && jobFields(this.current)),
          diagnostic: redactedDiagnostic(error),
        });
      fail();
    });
    worker.on('exit', fail);
    this.startup = setTimeout(() => {
      if (this.worker === worker) this.logger.error('Report worker did not start in time');
      fail();
    }, WORKER_DEADLINE_MS);
  }
  private receive(worker: Worker, message: Reply): void {
    if (message.startupFailed) {
      this.logger.error('Report worker failed to start', { diagnostic: message.startupFailed });
      return;
    }
    if (message.ready) {
      clearTimeout(this.startup);
      this.started = true;
      // Idle workers never hold the process open; `run` takes the reference back.
      worker.unref();
      this.events.available();
      return;
    }
    const job = this.current;
    if (!job || message.id !== job.id) return;
    if (message.chunk !== undefined) {
      const { id, bytes } = message;
      // The worker sends more only once the output took what it had sent.
      void job.output!(message.chunk).then(() => {
        if (this.worker === worker && this.current === job) worker.postMessage({ ack: { id, bytes } });
      });
      return;
    }
    if (message.diagnostic) this.logger.error('Report failed', { ...jobFields(job), diagnostic: message.diagnostic });
    this.current = undefined;
    worker.unref();
    this.events.settled(
      job.id,
      message.result,
      message.error
        ? message.error.kind === undefined
          ? new Error('Report failed')
          : new ApplicationError(message.error.kind, message.error.message, message.error.retryAfterSeconds)
        : undefined,
    );
  }
  private stop(): void {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.started = false;
    clearTimeout(this.startup);
    this.stopping = worker
      .terminate()
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        this.stopping = undefined;
        this.events.available();
      });
  }
  async close(): Promise<void> {
    this.current = undefined;
    clearTimeout(this.startup);
    if (this.stopping) await this.stopping;
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    worker.ref();
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        void worker.terminate();
      }, WORKER_DEADLINE_MS);
      worker.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      worker.postMessage({ close: true });
    });
  }
}

export function createReportExecution(
  placement: ReportPlacement,
  events: ExecutionEvents,
  logger: Logger,
): ReportExecution {
  return 'inline' in placement
    ? new InlineExecution(placement.inline, events, logger)
    : new WorkerExecution(placement.startWorker, events, logger);
}
