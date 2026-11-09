import type { StorageConfig } from '../storage/config.ts';
import { reportRunsInline } from '../storage/repositories/report-reader.ts';
import { RequestCancelled, unavailable } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import type { Authentication } from '../domain/credentials.ts';
import type { ExportAssemblyJob, ExportEmitter } from './exportJobs.ts';
import type { CsvDownloadJob, JobResult, ReportJob } from './reportJobs.ts';
import {
  createReportExecution,
  type ExecutionJob,
  type JobSource,
  type ReportExecution,
  type ReportWork,
  type WorkerStarter,
} from './reportExecution.ts';

export type { ReportWork };

/** A queued report usually finishes within a second or two, so a full queue asks for a short wait. */
const QUEUE_FULL_RETRY_SECONDS = 2;
const DEFAULT_MAX_QUEUE = 16;
const MAX_QUEUE_LIMIT = 100;
/** Downloads stream at the client's pace, so their lane is shorter than the report queue. */
const DEFAULT_MAX_DOWNLOADS = 8;
/**
 * Reports a lane runs at once, each in its own worker with its own reader. Reports are short and
 * busy the CPU, so two keep one slow report from holding the rest without crowding the API thread.
 */
export const DEFAULT_REPORT_CONCURRENCY = 2;
/**
 * Downloads a lane runs at once. A download waits on its client most of the time and may run for
 * the whole deadline, so three keep one slow reader from holding the lane.
 */
export const DEFAULT_DOWNLOAD_CONCURRENCY = 3;
/** How long one download may run once it starts, before it is given up. */
export const DEFAULT_DOWNLOAD_DEADLINE_MS = 15 * 60_000;
/** A download that ran out of time asks for a longer wait than a full queue. */
const DOWNLOAD_DEADLINE_RETRY_SECONDS = 60;

/** The limits of one lane: its places and each account's share of them. */
export interface LaneLimits {
  /** Includes the active job; overload fails immediately. Maximum 100. */
  maxQueue?: number;
  /**
   * The places one account may hold at once, reserved, queued or running. Default a quarter of
   * `maxQueue`, at least 1; at most `maxQueue`.
   */
  maxPerUser?: number;
  /**
   * Jobs the lane runs at once, each in its own worker. Default 2 for reports and 3 for downloads,
   * or `maxQueue` when that is smaller; at most `maxQueue`. In-memory SQLite runs one at a time on
   * the application's own connection.
   */
  concurrency?: number;
}

/** The download lane's limits, and how long one download may run. */
export interface DownloadLaneLimits extends LaneLimits {
  /** How long a download may run once it starts. Default 15 minutes. */
  deadlineMs?: number;
}

export interface ReportRunnerOptions extends LaneLimits {
  /**
   * The download lane: account exports and detailed CSV reports. Default 8 places, a quarter per
   * account, 3 running at once, 15 minutes each.
   */
  downloads?: DownloadLaneLimits;
  /** Where unexpected report and worker failures are logged, as redacted diagnostics. */
  logger?: Logger;
  /** How the runner starts its worker threads. Defaults to `startReportWorker`. */
  startWorker?: WorkerStarter;
}
interface Pending extends ExecutionJob {
  /** The account whose place this is. */
  userId: number;
  /** A report's result; an export settles without one. */
  resolve(result: JobResult | undefined): void;
  reject(error: Error): void;
  dispose(): void;
  /** Ends the job once its lane's deadline passes; set while it runs. */
  deadline?: ReturnType<typeof setTimeout>;
}
/**
 * A place in the report queue, held while its caller prepares one job. It queues one job only, for
 * the account that reserved the place.
 */
export interface ReportSlot {
  run(workspaceId: number, job: ReportJob, options?: { authentication?: Authentication }): Promise<JobResult>;
}
/**
 * A place in the download lane, held while its caller prepares one download. It queues one job
 * only, for the account that reserved the place.
 */
export interface DownloadSlot {
  /**
   * Writes the account's export to `output` a piece at a time, reading it in the job's own snapshot.
   * Settles once the last piece was taken.
   */
  export(
    assembly: ExportAssemblyJob,
    output: ExportEmitter,
    options?: { authentication?: Authentication },
  ): Promise<void>;
  /**
   * Writes the detailed CSV report `job` of `workspaceId` to `output` a batch at a time, reading it
   * in the job's own snapshot. Settles once the last piece was taken.
   */
  report(
    workspaceId: number,
    job: CsvDownloadJob,
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
 * What the application needs from a report runner: reserve a place, queue a report or a download
 * in it, and shut down. The composition root builds the runner and hands this to the
 * application services.
 */
export interface ReportExecutor {
  /**
   * Takes a place in the report queue, then runs `work` with it, so a full queue or a cancelled
   * request is refused before `work` reads anything. The place counts toward the queue limit until
   * `work` queues its job or settles. An account that already holds its share is refused like a
   * full queue.
   */
  reserve<T>(options: ReportReservation, work: (slot: ReportSlot) => Promise<T>): Promise<T>;
  /** Takes a place in the download lane, the same way. Downloads never wait behind reports. */
  reserveDownload<T>(options: ReportReservation, work: (slot: DownloadSlot) => Promise<T>): Promise<T>;
  /** Fails every queued job and stops the workers. */
  close(): Promise<void>;
}

/** Turns a reservation into a queued job. */
type Submit = (work: ReportWork, output?: ExportEmitter) => Promise<JobResult | undefined>;

interface LaneSettings {
  maxQueue: number;
  maxPerUser: number;
  concurrency: number;
  deadlineMs?: number;
}

/** Checks a lane's limits; `name` goes into the message of a bad one. */
function laneSettings(
  name: string,
  limits: DownloadLaneLimits,
  defaults: { maxQueue: number; concurrency: number },
): LaneSettings {
  const maxQueue = limits.maxQueue ?? defaults.maxQueue;
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 1 || maxQueue > MAX_QUEUE_LIMIT)
    throw new Error(`Invalid ${name} queue limit`);
  const maxPerUser = limits.maxPerUser ?? Math.max(1, Math.floor(maxQueue / 4));
  if (!Number.isSafeInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > maxQueue)
    throw new Error(`Invalid ${name} share per account`);
  const concurrency = limits.concurrency ?? Math.min(defaults.concurrency, maxQueue);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > maxQueue)
    throw new Error(`Invalid ${name} concurrency`);
  const { deadlineMs } = limits;
  if (deadlineMs !== undefined && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1))
    throw new Error(`Invalid ${name} deadline`);
  return { maxQueue, maxPerUser, concurrency, deadlineMs };
}

/** One execution of a lane and the job it runs, if any. */
interface Runner {
  readonly execution: ReportExecution;
  active?: Pending;
}

/**
 * One lane: a bounded queue in front of `concurrency` executions, each with at most one job in
 * flight. The lane admits and cancels jobs and picks the next one; each execution
 * (`reportExecution.ts`) runs its job in its own worker, or inline for in-memory SQLite, which has
 * one execution. Each account holds at most `maxPerUser` places, running ones included, and queued
 * jobs take turns between accounts: the next job is the oldest one of the account served longest
 * ago. A lane with a deadline gives up a job that runs longer.
 */
class Lane {
  private readonly settings: LaneSettings;
  private readonly runners: Runner[];
  private queue: Pending[] = [];
  /** Places reserved by callers still preparing their job, per account. */
  private reserved = new Map<number, number>();
  /** When each account with a place was last given a turn; accounts without one never were. */
  private served = new Map<number, number>();
  private turns = 0;
  private nextId = 1;
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    config: StorageConfig,
    inline: JobSource,
    settings: LaneSettings,
    options: { logger: Logger; startWorker?: WorkerStarter },
  ) {
    this.settings = settings;
    const count = reportRunsInline(config) ? 1 : settings.concurrency;
    this.runners = Array.from({ length: count }, () => {
      const runner: Runner = {
        execution: createReportExecution(
          structuredClone(config),
          inline,
          {
            settled: (id, result, error) => {
              if (runner.active?.id === id) this.finish(runner, runner.active, result, error);
            },
            available: () => this.pump(),
            failed: error => this.failAll(error, runner),
          },
          options,
        ),
      };
      return runner;
    });
  }
  async reserve<T>(options: ReportReservation, work: (submit: Submit) => Promise<T>): Promise<T> {
    const { userId } = options;
    this.refuse(options.signal);
    if (this.held() >= this.settings.maxQueue || this.held(userId) >= this.settings.maxPerUser)
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
    const submit: Submit = (work, output) => {
      if (!release()) return Promise.reject(new Error('A report slot queues one job'));
      try {
        this.refuse(options.signal);
        return this.enqueue(userId, work, output, options.signal);
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
  /** Throws when the runner is closed or the request already cancelled. */
  private refuse(signal: AbortSignal | undefined): void {
    if (this.closed) throw new Error('Report runner is closed');
    if (signal?.aborted) throw new RequestCancelled('Report cancelled');
  }
  /** The places held in all, or by one account: reserved, queued and running. */
  private held(userId?: number): number {
    const mine = (p: Pending | undefined) => !!p && (userId === undefined || p.userId === userId);
    const reserved =
      userId === undefined
        ? [...this.reserved.values()].reduce((sum, n) => sum + n, 0)
        : (this.reserved.get(userId) ?? 0);
    const running = this.runners.filter(r => mine(r.active)).length;
    return reserved + this.queue.filter(mine).length + running;
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
    if (runner) {
      runner.active = undefined;
      pending.dispose();
      pending.reject(error);
      runner.execution.cancel();
    } else {
      this.queue = this.queue.filter(p => p !== pending);
      pending.dispose();
      pending.reject(error);
    }
    this.forgetIdle(pending.userId);
    this.pump();
  }
  /**
   * Hands queued jobs to idle executions whose worker is up, then starts at most one more worker,
   * so a lane whose workers cannot open their reader fails its jobs after one attempt rather than
   * starting every worker it has.
   */
  private pump(): void {
    if (this.closed) return;
    const idle = this.runners.filter(r => !r.active);
    for (const runner of idle) {
      if (!this.queue.length) return;
      if (runner.execution.warm()) this.start(runner, this.next());
    }
    for (const runner of idle) {
      if (!this.queue.length || runner.active) continue;
      if (!runner.execution.ready()) return;
      this.start(runner, this.next());
    }
  }
  private start(runner: Runner, p: Pending): void {
    runner.active = p;
    const { deadlineMs } = this.settings;
    if (deadlineMs !== undefined)
      p.deadline = setTimeout(
        () => this.giveUp(p, unavailable('Download took too long', DOWNLOAD_DEADLINE_RETRY_SECONDS)),
        deadlineMs,
      );
    runner.execution.run(p);
  }
  private finish(runner: Runner, p: Pending, result?: JobResult, error?: Error): void {
    runner.active = undefined;
    this.forgetIdle(p.userId);
    p.dispose();
    if (error) p.reject(error);
    else p.resolve(result);
    this.pump();
  }
  /**
   * Fails every queued job and the job running on `failed`, or on every execution when the lane
   * closes. Jobs running on healthy workers carry on. Reserved places stay with their callers.
   */
  private failAll(error: Error, failed?: Runner): void {
    for (const runner of failed ? [failed] : this.runners) {
      const p = runner.active;
      if (!p) continue;
      runner.active = undefined;
      p.dispose();
      p.reject(error);
      this.forgetIdle(p.userId);
    }
    for (const p of this.queue.splice(0)) {
      p.dispose();
      p.reject(error);
      this.forgetIdle(p.userId);
    }
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
 * downloads, which stream at the pace the client reads and so may hold their place for long. Each
 * lane has its own queue, its own share per account and its own workers, 2 for reports and 3 for
 * downloads by default (or runs inline, one job at a time, for in-memory SQLite). A download that runs past the lane's deadline is given up: before its first
 * piece it answers 503 `Download took too long` with `Retry-After: 60`; after it the connection drops.
 */
export class ReportRunner implements ReportExecutor {
  private readonly reports: Lane;
  private readonly downloads: Lane;
  private closing: Promise<void> | undefined;

  /** `inline` runs the jobs when the database is in-memory SQLite, which a worker cannot open. */
  constructor(config: StorageConfig, inline: JobSource, options: ReportRunnerOptions = {}) {
    const reports = laneSettings(
      'report',
      { maxQueue: options.maxQueue, maxPerUser: options.maxPerUser, concurrency: options.concurrency },
      { maxQueue: DEFAULT_MAX_QUEUE, concurrency: DEFAULT_REPORT_CONCURRENCY },
    );
    const downloads = laneSettings(
      'download',
      { deadlineMs: DEFAULT_DOWNLOAD_DEADLINE_MS, ...options.downloads },
      { maxQueue: DEFAULT_MAX_DOWNLOADS, concurrency: DEFAULT_DOWNLOAD_CONCURRENCY },
    );
    const execution = {
      logger: options.logger ?? silentLogger,
      startWorker: options.startWorker,
    };
    this.reports = new Lane(config, inline, reports, execution);
    this.downloads = new Lane(config, inline, downloads, execution);
  }
  /** The slot runs work for the reservation's account only. */
  reserve<T>(options: ReportReservation, work: (slot: ReportSlot) => Promise<T>): Promise<T> {
    const { userId } = options;
    return this.reports.reserve(options, submit =>
      work({
        // A report always settles with its result.
        run: (workspaceId, job, { authentication } = {}) =>
          submit({ userId, workspaceId, job, authentication }) as Promise<JobResult>,
      }),
    );
  }
  /** The slot runs work for the reservation's account only. */
  reserveDownload<T>(options: ReportReservation, work: (slot: DownloadSlot) => Promise<T>): Promise<T> {
    const { userId } = options;
    return this.downloads.reserve(options, submit =>
      work({
        export: (assembly, output, { authentication } = {}) =>
          submit({ userId, assembly, authentication }, output).then(() => {}),
        report: (workspaceId, download, output, { authentication } = {}) =>
          submit({ userId, workspaceId, download, authentication }, output).then(() => {}),
      }),
    );
  }
  close(): Promise<void> {
    this.closing ??= Promise.all([this.reports.close(), this.downloads.close()]).then(() => {});
    return this.closing;
  }
}
