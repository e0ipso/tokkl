/**
 * Housekeeping that runs on a timer instead of inside requests. It deletes idempotency keys past
 * their retention, expired sessions, expired rate-limit rows, and used or expired invite and
 * password reset links. Each table is cleaned a batch per transaction, so no request waits long
 * behind it, and rows another write holds stay for a later run. Nothing here decides an answer:
 * every reader already ignores the expired rows, so a late run only lets the tables grow.
 *
 * The timer does not keep the process alive, and closing waits for a run in progress so storage is
 * not closed under it.
 */
import type {
  IdempotencyKeysRepository,
  RateLimitsRepository,
  SessionsRepository,
  TokensRepository,
} from '../domain/ports.ts';
import { idempotencyCutoff } from '../domain/idempotency.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';

/** How often the job runs. It only bounds the tables' growth. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** The repositories the job cleans, each through one batched delete. */
export interface MaintenanceRepositories {
  idempotencyKeys: Pick<IdempotencyKeysRepository, 'deleteExpired'>;
  sessions: Pick<SessionsRepository, 'deleteExpired'>;
  rateLimits: Pick<RateLimitsRepository, 'deleteExpired'>;
  tokens: Pick<TokensRepository, 'deleteSpent'>;
}

/** Opens the write transactions the job deletes in. A `Storage` is one. */
export interface MaintenanceTransactions {
  transaction<T>(work: (context: MaintenanceRepositories) => Promise<T>): Promise<T>;
}

/** One cleanup: deletes a batch and returns how many rows it deleted. */
type Cleanup = (repositories: MaintenanceRepositories, now: Date) => Promise<number>;

const CLEANUPS = {
  idempotencyKeys: (r, now) => r.idempotencyKeys.deleteExpired(idempotencyCutoff(now)),
  sessions: (r, now) => r.sessions.deleteExpired(now.toISOString()),
  rateLimits: (r, now) => r.rateLimits.deleteExpired(now.toISOString()),
  accountTokens: (r, now) => r.tokens.deleteSpent(now.toISOString()),
} as const satisfies Record<string, Cleanup>;

/** Rows each cleanup deleted in one run; a failed cleanup is left out. */
export type MaintenanceReport = Partial<Record<keyof typeof CLEANUPS, number>>;

/** Runs `cleanup` a batch per transaction until a batch deletes nothing, and returns the total. */
async function untilClean(storage: MaintenanceTransactions, cleanup: Cleanup, now: Date): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await storage.transaction(r => cleanup(r, now));
    if (!deleted) return total;
    total += deleted;
  }
}

/**
 * Runs every cleanup once, as of `now`. One that fails is logged and the others still run.
 */
export async function runMaintenance(
  storage: MaintenanceTransactions,
  { now = new Date(), logger = silentLogger }: { now?: Date; logger?: Logger } = {},
): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {};
  for (const [name, cleanup] of Object.entries(CLEANUPS) as [keyof typeof CLEANUPS, Cleanup][]) {
    try {
      report[name] = await untilClean(storage, cleanup, now);
    } catch (error) {
      logger.warn('Maintenance cleanup failed', { cleanup: name, error });
    }
  }
  const deleted = Object.fromEntries(Object.entries(report).filter(([, count]) => count));
  if (Object.keys(deleted).length) logger.debug('Maintenance deleted expired rows', deleted);
  return report;
}

export interface MaintenanceOptions {
  intervalMs?: number;
  logger?: Logger;
}

export interface Maintenance {
  /** Runs the job now, or joins the run in progress. */
  run(): Promise<void>;
  /** Stops the timer and waits for a run in progress. */
  close(): Promise<void>;
}

export function startMaintenance(
  storage: MaintenanceTransactions,
  { intervalMs = MAINTENANCE_INTERVAL_MS, logger = silentLogger }: MaintenanceOptions = {},
): Maintenance {
  let running: Promise<void> | undefined;
  let closed = false;
  const run = () =>
    closed
      ? Promise.resolve()
      : (running ??= runMaintenance(storage, { logger })
          .then(() => {})
          .finally(() => {
            running = undefined;
          }));
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return {
    run,
    async close() {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
