import { Worker } from 'node:worker_threads';
import type { StorageConfig } from '../storage/config.ts';
import { reportRunsInline } from '../storage/repositories/report-reader.ts';
import { ApplicationError, RequestCancelled, unavailable, type FailureKind } from '../lib/errors.ts';
import { redactedDiagnostic, silentLogger, type ErrorDiagnostic, type Logger } from '../lib/logger.ts';
import type { ReportSource } from './reports.ts';
import type { AccountExportProjection, User } from '../storage/domain.ts';
import type { Authentication } from '../domain/credentials.ts';
import {
  formatExportJob,
  runReportJob,
  type ExportAssemblyJob,
  type JobResult,
  type ReportJob,
  type ReportJobWork,
} from './reportJobs.ts';

/** A queued report usually finishes within a second or two, so a full queue asks for a short wait. */
const QUEUE_FULL_RETRY_SECONDS = 2;
const DEFAULT_MAX_QUEUE = 16;
const MAX_QUEUE_LIMIT = 100;

export interface ReportRunnerOptions {
  /** Includes the active job; overload fails immediately. Default 16, maximum 100. */
  maxQueue?: number;
  /**
   * The places one account may hold at once, reserved, queued or running. Default a quarter of
   * `maxQueue`, at least 1; at most `maxQueue`.
   */
  maxPerUser?: number;
  onPhase?: (phase: 'reading' | 'formatting') => void;
  /** Where unexpected report and worker failures are logged, as redacted diagnostics. */
  logger?: Logger;
}
interface Pending {
  id: number;
  /** The account whose place this is. */
  userId: number;
  work: ReportWork;
  resolve(result: JobResult): void;
  reject(error: Error): void;
  dispose(): void;
}
export type ReportWork = ReportJobWork | { data: AccountExportProjection; assembly: ExportAssemblyJob };
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

/** A place in the report queue, held while its caller prepares one job. It queues one job only. */
export interface ReportSlot {
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options?: { authentication?: Authentication },
  ): Promise<JobResult>;
  assembleExport(data: AccountExportProjection, assembly: ExportAssemblyJob): Promise<JobResult>;
}

/** Whose place a reservation is, and the request that may cancel it. */
export interface ReportReservation {
  userId: number;
  signal?: AbortSignal;
}

/**
 * What the application needs from a report runner: reserve a place, queue a report or an export
 * assembly in it, and shut down. The composition root builds the runner and hands this to the
 * application services.
 */
export interface ReportExecutor {
  /**
   * Takes a place in the queue, then runs `work` with it, so a full queue or a cancelled request
   * is refused before `work` reads anything. The place counts toward the queue limit until `work`
   * queues its job or settles. An account that already holds its share is refused like a full
   * queue.
   */
  reserve<T>(options: ReportReservation, work: (slot: ReportSlot) => Promise<T>): Promise<T>;
  /** Fails every queued job and stops the worker. */
  close(): Promise<void>;
}

/** The export without the password hash and API token, which the worker never needs. */
function credentialFree(data: AccountExportProjection): AccountExportProjection {
  // Structural typing permits a full User where the credential-free view was expected.
  const projection = { ...data, user: { ...data.user } };
  delete (projection.user as Partial<User>).passwordHash;
  delete (projection.user as Partial<User>).apiToken;
  return projection;
}

/** The job's kind and the runner's id for it: what a log line may say about a job. */
function jobFields(p: Pending) {
  return { jobId: p.id, jobKind: 'assembly' in p.work ? p.work.assembly.kind : p.work.job.kind };
}

/**
 * One runner per app, one worker/reader, a bounded parent queue and one job in flight. Each account
 * holds at most `maxPerUser` places, and queued jobs take turns between accounts: the next job is
 * the oldest one of the account served longest ago.
 */
export class ReportRunner implements ReportExecutor {
  private readonly config: StorageConfig;
  private readonly inline: ReportSource;
  private readonly options: ReportRunnerOptions;
  private readonly maxQueue: number;
  private readonly maxPerUser: number;
  private readonly logger: Logger;
  private worker: Worker | null = null;
  private ready = false;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private active: Pending | undefined;
  private queue: Pending[] = [];
  /** Places reserved by callers still preparing their job, per account. */
  private reserved = new Map<number, number>();
  /** When each account with a place was last given a turn; accounts without one never were. */
  private served = new Map<number, number>();
  private turns = 0;
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
    this.maxPerUser = options.maxPerUser ?? Math.max(1, Math.floor(this.maxQueue / 4));
    if (!Number.isSafeInteger(this.maxPerUser) || this.maxPerUser < 1 || this.maxPerUser > this.maxQueue)
      throw new Error('Invalid report share per account');
  }
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options: { signal?: AbortSignal; authentication?: Authentication } = {},
  ): Promise<JobResult> {
    return this.reserve({ userId, signal: options.signal }, slot => slot.run(userId, workspaceId, job, options));
  }
  assembleExport(
    data: AccountExportProjection,
    assembly: ExportAssemblyJob,
    options: { signal?: AbortSignal } = {},
  ): Promise<JobResult> {
    return this.reserve({ userId: data.user.id, signal: options.signal }, slot => slot.assembleExport(data, assembly));
  }
  async reserve<T>(options: ReportReservation, work: (slot: ReportSlot) => Promise<T>): Promise<T> {
    const { userId } = options;
    this.refuse(options.signal);
    if (this.held() >= this.maxQueue || this.held(userId) >= this.maxPerUser)
      throw unavailable('Report queue is full', QUEUE_FULL_RETRY_SECONDS);
    this.reserved.set(userId, (this.reserved.get(userId) ?? 0) + 1);
    let held = true;
    const release = () => {
      if (!held) return false;
      held = false;
      const left = this.reserved.get(userId)! - 1;
      if (left) this.reserved.set(userId, left);
      else this.reserved.delete(userId);
      this.forgetIdle(userId);
      return true;
    };
    /** Turns the reservation into a queued job; `build` runs only once the request still stands. */
    const submit = (build: () => ReportWork): Promise<JobResult> => {
      if (!release()) return Promise.reject(new Error('A report slot queues one job'));
      try {
        this.refuse(options.signal);
        return this.enqueue(userId, build(), options.signal);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const slot: ReportSlot = {
      run: (userId, workspaceId, job, { authentication } = {}) =>
        submit(() => ({ userId, workspaceId, job, authentication })),
      assembleExport: (data, assembly) => submit(() => ({ data: credentialFree(data), assembly })),
    };
    try {
      return await work(slot);
    } finally {
      release();
    }
  }
  /** Throws when the runner is closed or the request already cancelled. */
  private refuse(signal: AbortSignal | undefined): void {
    if (this.closed) throw new Error('Report runner is closed');
    if (signal?.aborted) throw new RequestCancelled('Report cancelled');
  }
  /** The places held in all, or by one account: reserved, queued and running. */
  private held(userId?: number): number {
    if (userId === undefined)
      return [...this.reserved.values()].reduce((sum, n) => sum + n, this.queue.length + Number(!!this.active));
    return (
      (this.reserved.get(userId) ?? 0) +
      this.queue.filter(p => p.userId === userId).length +
      Number(this.active?.userId === userId)
    );
  }
  /** An account that holds no place loses its turn history, so the map stays as small as the queue. */
  private forgetIdle(userId: number): void {
    if (!this.held(userId)) this.served.delete(userId);
  }
  /** Takes the next job: the oldest queued job of the account whose last turn came longest ago. */
  private next(): Pending {
    let chosen = 0;
    let turn = Infinity;
    this.queue.forEach((p, i) => {
      const last = this.served.get(p.userId) ?? -1;
      if (last < turn) [chosen, turn] = [i, last];
    });
    const [p] = this.queue.splice(chosen, 1);
    this.served.set(p!.userId, ++this.turns);
    return p!;
  }
  /** Queues `work` in a place `userId` reserved. */
  private enqueue(userId: number, work: ReportWork, signal: AbortSignal | undefined): Promise<JobResult> {
    const options = { signal };
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        id: this.nextId++,
        userId,
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
        this.forgetIdle(userId);
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
      const p = this.next();
      this.active = p;
      const work = p.work;
      const build =
        'assembly' in work
          ? Promise.resolve().then(() => formatExportJob(work.data, work.assembly))
          : runReportJob(this.inline, work);
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
    const p = this.next();
    this.active = p;
    this.worker!.ref();
    this.worker!.postMessage({ id: p.id, work: p.work });
  }
  private safeError(error: unknown): Error {
    return error instanceof ApplicationError ? error : new Error('Report failed');
  }
  private finish(p: Pending, result?: JobResult, error?: Error): void {
    this.active = undefined;
    this.forgetIdle(p.userId);
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
      this.served.clear();
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
    this.served.clear();
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
