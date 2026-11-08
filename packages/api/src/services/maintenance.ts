/**
 * Housekeeping that runs on a timer instead of inside requests: it forgets idempotency keys past
 * their retention. The timer does not keep the process alive, and closing waits for a run in
 * progress so storage is not closed under it.
 */
import { forgetExpiredIdempotencyKeys, type IdempotencyTransactions } from '../domain/idempotency.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';

/** How often the job runs. A key past its retention is ignored until then, so this only bounds the table's growth. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

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
  storage: IdempotencyTransactions,
  { intervalMs = MAINTENANCE_INTERVAL_MS, logger = silentLogger }: MaintenanceOptions = {},
): Maintenance {
  let running: Promise<void> | undefined;
  let closed = false;
  const run = () =>
    closed
      ? Promise.resolve()
      : (running ??= forgetExpiredIdempotencyKeys(storage)
          .then(
            deleted => {
              if (deleted) logger.debug('Expired idempotency keys deleted', { deleted });
            },
            (error: unknown) => logger.warn('Idempotency key cleanup failed', { error }),
          )
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
