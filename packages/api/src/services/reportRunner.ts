import type { StorageConfig } from '../storage/config.ts';
import { RequestCancelled, unavailable } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import type { Authentication } from '../domain/credentials.ts';
import type { ExportAssemblyJob, ExportEmitter } from './exportJobs.ts';
import type { JobResult, ReportJob } from './reportJobs.ts';
import {
  createReportExecution,
  type ExecutionJob,
  type JobSource,
  type ReportExecution,
  type ReportPhase,
  type ReportWork,
} from './reportExecution.ts';

export type { ReportWork };

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
  onPhase?: (phase: ReportPhase) => void;
  /** Where unexpected report and worker failures are logged, as redacted diagnostics. */
  logger?: Logger;
}
interface Pending extends ExecutionJob {
  /** The account whose place this is. */
  userId: number;
  /** A report's result; an export settles without one. */
  resolve(result: JobResult | undefined): void;
  reject(error: Error): void;
  dispose(): void;
}
/** A place in the report queue, held while its caller prepares one job. It queues one job only. */
export interface ReportSlot {
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options?: { authentication?: Authentication },
  ): Promise<JobResult>;
  /**
   * Writes `userId`'s export to `output` a piece at a time, reading it in the job's own snapshot.
   * Settles once the last piece was taken.
   */
  export(
    userId: number,
    assembly: ExportAssemblyJob,
    output: ExportEmitter,
    options?: { authentication?: Authentication },
  ): Promise<void>;
}

/** Whose place a reservation is, and the request that may cancel it. */
export interface ReportReservation {
  userId: number;
  signal?: AbortSignal;
}

/**
 * What the application needs from a report runner: reserve a place, queue a report or an export
 * in it, and shut down. The composition root builds the runner and hands this to the
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

/**
 * One runner per app: a bounded queue in front of one execution, with one job in flight. The runner
 * admits and cancels jobs and picks the next one; the execution (`reportExecution.ts`) runs it in
 * the worker, or inline for in-memory SQLite. Each account holds at most `maxPerUser` places, and
 * queued jobs take turns between accounts: the next job is the oldest one of the account served
 * longest ago.
 */
export class ReportRunner implements ReportExecutor {
  private readonly maxQueue: number;
  private readonly maxPerUser: number;
  private readonly execution: ReportExecution;
  private active: Pending | undefined;
  private queue: Pending[] = [];
  /** Places reserved by callers still preparing their job, per account. */
  private reserved = new Map<number, number>();
  /** When each account with a place was last given a turn; accounts without one never were. */
  private served = new Map<number, number>();
  private turns = 0;
  private nextId = 1;
  private closed = false;
  private closing: Promise<void> | undefined;

  /** `inline` runs the jobs when the database is in-memory SQLite, which a worker cannot open. */
  constructor(config: StorageConfig, inline: JobSource, options: ReportRunnerOptions = {}) {
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    if (!Number.isSafeInteger(this.maxQueue) || this.maxQueue < 1 || this.maxQueue > MAX_QUEUE_LIMIT)
      throw new Error('Invalid report queue limit');
    this.maxPerUser = options.maxPerUser ?? Math.max(1, Math.floor(this.maxQueue / 4));
    if (!Number.isSafeInteger(this.maxPerUser) || this.maxPerUser < 1 || this.maxPerUser > this.maxQueue)
      throw new Error('Invalid report share per account');
    this.execution = createReportExecution(
      structuredClone(config),
      inline,
      {
        settled: (id, result, error) => {
          if (this.active?.id === id) this.finish(this.active, result, error);
        },
        available: () => this.pump(),
        failed: error => this.failAll(error),
      },
      { logger: options.logger ?? silentLogger, onPhase: options.onPhase },
    );
  }
  /** The worker running jobs, while there is one. */
  private get worker() {
    return this.execution.worker;
  }
  run(
    userId: number,
    workspaceId: number,
    job: ReportJob,
    options: { signal?: AbortSignal; authentication?: Authentication } = {},
  ): Promise<JobResult> {
    return this.reserve({ userId, signal: options.signal }, slot => slot.run(userId, workspaceId, job, options));
  }
  export(
    userId: number,
    assembly: ExportAssemblyJob,
    output: ExportEmitter,
    options: { signal?: AbortSignal; authentication?: Authentication } = {},
  ): Promise<void> {
    return this.reserve({ userId, signal: options.signal }, slot => slot.export(userId, assembly, output, options));
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
    const submit = (work: ReportWork, output?: ExportEmitter): Promise<JobResult | undefined> => {
      if (!release()) return Promise.reject(new Error('A report slot queues one job'));
      try {
        this.refuse(options.signal);
        return this.enqueue(userId, work, output, options.signal);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const slot: ReportSlot = {
      // A report always settles with its result.
      run: (userId, workspaceId, job, { authentication } = {}) =>
        submit({ userId, workspaceId, job, authentication }) as Promise<JobResult>,
      export: (userId, assembly, output, { authentication } = {}) =>
        submit({ userId, assembly, authentication }, output).then(() => {}),
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
  private enqueue(
    userId: number,
    work: ReportWork,
    output: ExportEmitter | undefined,
    signal: AbortSignal | undefined,
  ): Promise<JobResult | undefined> {
    const options = { signal };
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        id: this.nextId++,
        userId,
        work: structuredClone(work),
        output,
        resolve,
        reject,
        dispose: () => options.signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        if (this.active === pending) {
          this.active = undefined;
          pending.dispose();
          pending.reject(new RequestCancelled('Report cancelled'));
          this.execution.cancel();
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
    if (this.closed || this.active || !this.queue.length || !this.execution.ready()) return;
    const p = this.next();
    this.active = p;
    this.execution.run(p);
  }
  private finish(p: Pending, result?: JobResult, error?: Error): void {
    this.active = undefined;
    this.forgetIdle(p.userId);
    p.dispose();
    if (error) p.reject(error);
    else p.resolve(result);
    this.pump();
  }
  /** Fails the running job and every queued one. Reserved places stay with their callers. */
  private failAll(error: Error): void {
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
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.failAll(new Error('Report runner is closed'));
    this.closing = this.execution.close();
    return this.closing;
  }
}
