import { RequestCancelled, unavailable } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import type { Authentication } from '../domain/credentials.ts';
import type { ExportAssemblyJob, ExportEmitter } from './exportJobs.ts';
import type { CsvDownloadJob, JobResult, ReportJob } from './reportJobs.ts';
import {
  createReportExecution,
  type ExecutionJob,
  type ReportExecution,
  type ReportPlacement,
  type ReportWork,
} from './reportExecution.ts';

/** A queued report usually finishes within a second or two, so a full queue asks for a short wait. */
const QUEUE_FULL_RETRY_SECONDS = 2;
/** A download that ran out of time asks for a longer wait than a full queue. */
const DOWNLOAD_DEADLINE_RETRY_SECONDS = 60;
/** Reports are short and busy the CPU; downloads wait on their client and may run for the deadline. */
const REPORT_DEFAULTS = { maxQueue: 16, concurrency: 2 };
const DOWNLOAD_DEFAULTS = { maxQueue: 8, concurrency: 3, deadlineMs: 15 * 60_000 };

/** The limits of one lane. `maxQueue` counts reserved, queued and running places. */
export interface LaneLimits {
  maxQueue?: number;
  /** Places one account may hold at once. Default a quarter of `maxQueue`, at least 1. */
  maxPerUser?: number;
  /** Jobs run at once, each in its own worker. In-memory SQLite runs one inline. */
  concurrency?: number;
  /** How long a job may run once it starts. Downloads default to 15 minutes; reports have none. */
  deadlineMs?: number;
}

export interface ReportRunnerOptions extends LaneLimits {
  /** The download lane: account exports and detailed CSV reports. */
  downloads?: LaneLimits;
  logger?: Logger;
}

type Options = { authentication?: Authentication };

/** A place in a lane, held while its caller prepares one job for the account that reserved it. */
export interface ReportSlot {
  run(workspaceId: number, job: ReportJob, options?: Options): Promise<JobResult>;
  /** Writes the account's export to `output` a piece at a time, in the job's own snapshot. */
  export(assembly: ExportAssemblyJob, output: ExportEmitter, options?: Options): Promise<void>;
  /** Writes a detailed CSV report to `output` a batch at a time, in the job's own snapshot. */
  report(workspaceId: number, job: CsvDownloadJob, output: ExportEmitter, options?: Options): Promise<void>;
}

type Reservation = { userId: number; signal?: AbortSignal };

interface Pending extends ExecutionJob {
  userId: number;
  resolve(result: JobResult | undefined): void;
  reject(error: Error): void;
  dispose(): void;
  deadline?: ReturnType<typeof setTimeout>;
}

type Submit = (work: ReportWork, output?: ExportEmitter) => Promise<JobResult | undefined>;

interface Runner {
  readonly execution: ReportExecution;
  active?: Pending;
}

function settle(p: Pending, error?: Error, result?: JobResult): void {
  p.dispose();
  if (error) p.reject(error);
  else p.resolve(result);
}

/**
 * One lane: a bounded FIFO queue in front of `concurrency` executions (`reportExecution.ts`), each
 * with at most one job in flight. Each account holds at most `maxPerUser` places, running ones included.
 */
class Lane {
  private readonly maxQueue: number;
  private readonly maxPerUser: number;
  private readonly deadlineMs: number | undefined;
  private readonly runners: Runner[];
  private queue: Pending[] = [];
  /** The account of each place reserved by a caller still preparing its job. */
  private reserved: number[] = [];
  private nextId = 1;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(placement: ReportPlacement, limits: LaneLimits, defaults: LaneLimits, logger: Logger) {
    const { maxQueue = defaults.maxQueue!, concurrency = Math.min(defaults.concurrency!, maxQueue) } = limits;
    this.maxQueue = maxQueue;
    this.maxPerUser = limits.maxPerUser ?? Math.max(1, Math.floor(maxQueue / 4));
    this.deadlineMs = limits.deadlineMs ?? defaults.deadlineMs;
    const count = 'inline' in placement ? 1 : concurrency;
    this.runners = Array.from({ length: count }, () => {
      const runner: Runner = {
        execution: createReportExecution(
          placement,
          {
            settled: (id, result, error) => {
              if (runner.active?.id === id) this.finish(runner, result, error);
            },
            available: () => this.pump(),
            failed: error => this.failAll(error, runner),
          },
          logger,
        ),
      };
      return runner;
    });
  }
  async reserve<T>({ userId, signal }: Reservation, work: (submit: Submit) => Promise<T>): Promise<T> {
    this.refuse(signal);
    if (this.held() >= this.maxQueue || this.held(userId) >= this.maxPerUser)
      throw unavailable('Report queue is full', QUEUE_FULL_RETRY_SECONDS);
    this.reserved.push(userId);
    let held = true;
    const release = () => {
      if (!held) return false;
      held = false;
      this.reserved.splice(this.reserved.indexOf(userId), 1);
      return true;
    };
    const submit: Submit = (job, output) => {
      if (!release()) return Promise.reject(new Error('A report slot queues one job'));
      try {
        this.refuse(signal);
        return this.enqueue(userId, job, output, signal);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    try {
      return await work(submit);
    } finally {
      release();
    }
  }
  private refuse(signal: AbortSignal | undefined): void {
    if (this.closed) throw new Error('Report runner is closed');
    if (signal?.aborted) throw new RequestCancelled('Report cancelled');
  }
  /** The places held in all, or by one account: reserved, queued and running. */
  private held(userId?: number): number {
    const owners = [...this.reserved, ...this.queue.map(p => p.userId), ...this.runners.map(r => r.active?.userId)];
    return owners.filter(id => id !== undefined && (userId === undefined || id === userId)).length;
  }
  private enqueue(
    userId: number,
    work: ReportWork,
    output: ExportEmitter | undefined,
    signal: AbortSignal | undefined,
  ): Promise<JobResult | undefined> {
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        id: this.nextId++,
        userId,
        work: structuredClone(work),
        output,
        resolve,
        reject,
        dispose: () => {
          clearTimeout(pending.deadline);
          signal?.removeEventListener('abort', abort);
        },
      };
      const abort = () => this.giveUp(pending, new RequestCancelled('Report cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(pending);
      this.pump();
    });
  }
  /** Fails `pending` with `error`, wherever it is; a running job's execution stops it. */
  private giveUp(pending: Pending, error: Error): void {
    const runner = this.runners.find(r => r.active === pending);
    if (runner) runner.active = undefined;
    else this.queue = this.queue.filter(p => p !== pending);
    settle(pending, error);
    runner?.execution.cancel();
    this.pump();
  }
  /**
   * Hands queued jobs to idle executions in order. A pass starts at most one worker, so a lane
   * whose workers cannot open their reader fails its jobs after one attempt.
   */
  private pump(): void {
    if (this.closed) return;
    for (const runner of this.runners) {
      if (!this.queue.length) return;
      if (runner.active) continue;
      if (!runner.execution.ready()) return;
      this.start(runner, this.queue.shift()!);
    }
  }
  private start(runner: Runner, p: Pending): void {
    runner.active = p;
    if (this.deadlineMs !== undefined)
      p.deadline = setTimeout(
        () => this.giveUp(p, unavailable('Download took too long', DOWNLOAD_DEADLINE_RETRY_SECONDS)),
        this.deadlineMs,
      );
    runner.execution.run(p);
  }
  private finish(runner: Runner, result?: JobResult, error?: Error): void {
    const p = runner.active!;
    runner.active = undefined;
    settle(p, error, result);
    this.pump();
  }
  /**
   * Fails every queued job and the job running on `failed`, or on every execution when the lane
   * closes. Jobs on healthy workers carry on; reserved places stay with their callers.
   */
  private failAll(error: Error, failed?: Runner): void {
    for (const runner of failed ? [failed] : this.runners) {
      const p = runner.active;
      runner.active = undefined;
      if (p) settle(p, error);
    }
    for (const p of this.queue.splice(0)) settle(p, error);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.failAll(new Error('Report runner is closed'));
    this.closing = Promise.all(this.runners.map(r => r.execution.close())).then(() => {});
    return this.closing;
  }
}

/**
 * One runner per app, with two lanes that never wait for each other: reports, answered whole, and
 * downloads, which stream at the client's pace. A download past the lane's deadline is given up:
 * before its first piece it answers 503 `Download took too long` with `Retry-After: 60`.
 */
export class ReportRunner {
  private readonly reports: Lane;
  private readonly downloads: Lane;
  private closing: Promise<void> | undefined;

  /** `placement` says where the jobs run: `reportRunners.ts` picks it for a storage configuration. */
  constructor(placement: ReportPlacement, options: ReportRunnerOptions = {}) {
    const logger = options.logger ?? silentLogger;
    const { downloads = {}, ...reports } = options;
    this.reports = new Lane(placement, reports, REPORT_DEFAULTS, logger);
    this.downloads = new Lane(placement, downloads, DOWNLOAD_DEFAULTS, logger);
  }
  /**
   * Takes a place in the report queue, then runs `work` with it, so a full queue, a full share for
   * the account or a cancelled request is refused before `work` reads anything.
   */
  reserve<T>(reservation: Reservation, work: (slot: ReportSlot) => Promise<T>): Promise<T> {
    return this.reports.reserve(reservation, submit => work(slotFor(reservation.userId, submit)));
  }
  /** Takes a place in the download lane, the same way. Downloads never wait behind reports. */
  reserveDownload<T>(reservation: Reservation, work: (slot: ReportSlot) => Promise<T>): Promise<T> {
    return this.downloads.reserve(reservation, submit => work(slotFor(reservation.userId, submit)));
  }
  /** Fails every queued job and stops the workers. */
  close(): Promise<void> {
    this.closing ??= Promise.all([this.reports.close(), this.downloads.close()]).then(() => {});
    return this.closing;
  }
}

/** The slot runs work for the reservation's account only. */
function slotFor(userId: number, submit: Submit): ReportSlot {
  return {
    // A report always settles with its result.
    run: (workspaceId, job, { authentication } = {}) =>
      submit({ userId, workspaceId, job, authentication }) as Promise<JobResult>,
    export: (assembly, output, { authentication } = {}) =>
      submit({ userId, assembly, authentication }, output).then(() => {}),
    report: (workspaceId, download, output, { authentication } = {}) =>
      submit({ userId, workspaceId, download, authentication }, output).then(() => {}),
  };
}

/** What the application needs from a report runner. */
export type ReportExecutor = Pick<ReportRunner, 'reserve' | 'reserveDownload' | 'close'>;
