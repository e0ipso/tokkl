/** Deletes expired rows a batch per transaction. Readers ignore expired rows, so a late run only lets tables grow. */
import type {
  Clock,
  IdempotencyKeysRepository,
  RateLimitsRepository,
  SessionsRepository,
  TokensRepository,
} from '../domain/ports.ts';
import { idempotencyCutoff } from '../domain/idempotency.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';

/** It only bounds the tables' growth. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

interface MaintenanceRepositories {
  idempotencyKeys: Pick<IdempotencyKeysRepository, 'deleteExpired'>;
  sessions: Pick<SessionsRepository, 'deleteExpired'>;
  rateLimits: Pick<RateLimitsRepository, 'deleteExpired'>;
  tokens: Pick<TokensRepository, 'deleteSpent'>;
}

/** A `Storage` is one. */
interface MaintenanceTransactions {
  transaction<T>(work: (context: MaintenanceRepositories) => Promise<T>): Promise<T>;
}

type Cleanup = (repositories: MaintenanceRepositories, now: Date) => Promise<number>;

const CLEANUPS = {
  idempotencyKeys: (r, now) => r.idempotencyKeys.deleteExpired(idempotencyCutoff(now)),
  sessions: (r, now) => r.sessions.deleteExpired(now.toISOString()),
  rateLimits: (r, now) => r.rateLimits.deleteExpired(now.toISOString()),
  accountTokens: (r, now) => r.tokens.deleteSpent(now.toISOString()),
} as const satisfies Record<string, Cleanup>;

/** A failed cleanup is left out. */
type MaintenanceReport = Partial<Record<keyof typeof CLEANUPS, number>>;

/** Until a batch deletes nothing. */
async function untilClean(storage: MaintenanceTransactions, cleanup: Cleanup, now: Date): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await storage.transaction(r => cleanup(r, now));
    if (!deleted) return total;
    total += deleted;
  }
}

/** As of the time `clock` reads at the start. A failing cleanup is logged and the others still run. */
export async function runMaintenance(
  storage: MaintenanceTransactions,
  { clock, logger = silentLogger }: { clock: Clock; logger?: Logger },
): Promise<MaintenanceReport> {
  const now = clock.now();
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

export function startMaintenance(
  storage: MaintenanceTransactions,
  { clock, logger = silentLogger }: { clock: Clock; logger?: Logger },
) {
  let running: Promise<void> | undefined;
  let closed = false;
  const timer = setInterval(() => {
    if (closed) return;
    running ??= runMaintenance(storage, { clock, logger })
      .then(() => {})
      .finally(() => {
        running = undefined;
      });
  }, MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return {
    /** Waits for a run in progress, so storage is not closed under it. */
    async close() {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
