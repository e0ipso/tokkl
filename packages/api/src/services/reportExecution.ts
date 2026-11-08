/**
 * Where a report job runs once the runner's queue picks it: in the report worker, or inline on the
 * application's own connection when the database is in-memory SQLite. An execution runs one job at
 * a time and knows nothing of queues, accounts or requests; `reportRunner.ts` owns those.
 */
import { Worker } from 'node:worker_threads';
import type { StorageConfig } from '../storage/config.ts';
import { reportRunsInline } from '../storage/repositories/report-reader.ts';
import { ApplicationError, type FailureKind } from '../lib/errors.ts';
import { redactedDiagnostic, type ErrorDiagnostic, type Logger } from '../lib/logger.ts';
import type { AccountExportProjection } from '../storage/domain.ts';
import type { ReportSource } from './reports.ts';
import {
  formatExportJob,
  runReportJob,
  type ExportAssemblyJob,
  type JobResult,
  type ReportJobWork,
} from './reportJobs.ts';

export type ReportWork = ReportJobWork | { data: AccountExportProjection; assembly: ExportAssemblyJob };

/** One job as an execution receives it: the runner's id for it and what to run. */
export interface ExecutionJob {
  id: number;
  work: ReportWork;
}

export type ReportPhase = 'reading' | 'formatting';

/** What an execution tells the runner. */
export interface ExecutionEvents {
  /** The job `id` ended with `result`, or with `error`, a message safe to show the client. */
  settled(id: number, result?: JobResult, error?: Error): void;
  /** The execution can take a job, after it started, stopped or finished one. */
  available(): void;
  /** The worker stopped: the running job and every queued one fail with `error`. */
  failed(error: Error): void;
}

export interface ReportExecution {
  /** The worker running jobs, while there is one. */
  readonly worker: Worker | null;
  /**
   * True when `run` may be called now. The first call starts the worker; `available` follows once
   * it is ready.
   */
  ready(): boolean;
  /** Runs `job`; its outcome goes to `settled`. */
  run(job: ExecutionJob): void;
  /** Gives up the running job: its outcome is never reported, and a worker running it stops. */
  cancel(): void;
  /** Stops for good, once the running job's snapshot and the worker are released. */
  close(): Promise<void>;
}

export interface ReportExecutionOptions {
  logger: Logger;
  onPhase?: (phase: ReportPhase) => void;
}

/** What a worker sends back. */
interface Reply {
  id?: number;
  ready?: boolean;
  phase?: ReportPhase;
  result?: JobResult;
  /** An application failure keeps its kind and message; anything else arrives without a kind. */
  error?: { kind?: FailureKind; message: string; retryAfterSeconds?: number };
  /** Sent with an unexpected failure, for the log only. */
  diagnostic?: ErrorDiagnostic;
  /** The worker could not open its reader. */
  startupFailed?: ErrorDiagnostic;
}

/** The job's kind and the runner's id for it: what a log line may say about a job. */
export function jobFields(job: ExecutionJob) {
  return { jobId: job.id, jobKind: 'assembly' in job.work ? job.work.assembly.kind : job.work.job.kind };
}

const safeError = (error: unknown): Error => (error instanceof ApplicationError ? error : new Error('Report failed'));

/** How long a worker may take to open its reader, and to close it on shutdown. */
const WORKER_DEADLINE_MS = 30000;

/** Runs jobs on the application's own connection. Used for in-memory SQLite, which a worker cannot open. */
class InlineExecution implements ReportExecution {
  readonly worker = null;
  private readonly source: ReportSource;
  private readonly events: ExecutionEvents;
  private readonly logger: Logger;
  private current: ExecutionJob | undefined;
  /** The running job, until its snapshot is released, even after it was cancelled. */
  private work: Promise<void> | undefined;

  constructor(source: ReportSource, events: ExecutionEvents, logger: Logger) {
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
    const build =
      'assembly' in work
        ? Promise.resolve().then(() => formatExportJob(work.data, work.assembly))
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

/**
 * Runs jobs in one worker thread with its own reader. A worker that crashes, exits or does not
 * start in time fails every job, and the next job starts a fresh one once the old one has exited.
 */
class WorkerExecution implements ReportExecution {
  worker: Worker | null = null;
  private readonly config: StorageConfig;
  private readonly events: ExecutionEvents;
  private readonly options: ReportExecutionOptions;
  private started = false;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private current: ExecutionJob | undefined;
  /** A stopped worker, until it has exited. No replacement opens its reader before then. */
  private stopping: Promise<void> | undefined;

  constructor(config: StorageConfig, events: ExecutionEvents, options: ReportExecutionOptions) {
    this.config = config;
    this.events = events;
    this.options = options;
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
    const worker = new Worker(new URL('./reportWorker.ts', import.meta.url), { workerData: this.config });
    this.worker = worker;
    const fail = () => {
      if (this.worker !== worker) return;
      // Wait for this worker's exit before allowing a replacement reader to open.
      this.stop();
      this.current = undefined;
      this.events.failed(new Error('Report worker stopped'));
    };
    worker.on('message', (message: Reply) => {
      if (this.worker === worker) this.receive(worker, message);
    });
    worker.on('error', error => {
      if (this.worker === worker)
        this.options.logger.error('Report worker crashed', {
          ...(this.current && jobFields(this.current)),
          diagnostic: redactedDiagnostic(error),
        });
      fail();
    });
    worker.on('exit', fail);
    this.startup = setTimeout(() => {
      if (this.worker === worker) this.options.logger.error('Report worker did not start in time');
      fail();
    }, WORKER_DEADLINE_MS);
  }
  private receive(worker: Worker, message: Reply): void {
    if (message.startupFailed) {
      this.options.logger.error('Report worker failed to start', { diagnostic: message.startupFailed });
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
    if (message.phase) {
      try {
        this.options.onPhase?.(message.phase);
      } catch {
        /* Observers do not own jobs. */
      }
      return;
    }
    if (message.diagnostic)
      this.options.logger.error('Report failed', { ...jobFields(job), diagnostic: message.diagnostic });
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

/** The execution for `config`: inline for in-memory SQLite, a worker for everything else. */
export function createReportExecution(
  config: StorageConfig,
  inline: ReportSource,
  events: ExecutionEvents,
  options: ReportExecutionOptions,
): ReportExecution {
  return reportRunsInline(config)
    ? new InlineExecution(inline, events, options.logger)
    : new WorkerExecution(config, events, options);
}
