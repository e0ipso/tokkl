import type { StorageConnection } from './connections.ts';
import type { PhysicalDatabase } from './physical.ts';
import type { RateLimitChecks, Repositories, Storage, TransactionContext } from '../domain/ports.ts';
import { createTransactionRunner, type TransactionRunnerOptions } from './transactions.ts';
import { createAccountRepositories } from './repositories/accounts.ts';
import { createCatalogRepositories } from './repositories/catalogs.ts';
import { createEntryRepositories } from './repositories/entries.ts';
import { createTimerRepositories } from './repositories/timers.ts';
import { createTransferRepositories } from './repositories/transfers.ts';
import { createReportRepositories } from './repositories/reports.ts';

type StorageOptions = TransactionRunnerOptions;

/** Takes ownership of an initialized connection. Every operation binds all repositories together. */
export function createStorage(connection: StorageConnection<PhysicalDatabase>, options: StorageOptions = {}): Storage {
  const operations = createTransactionRunner(
    connection,
    db => ({
      ...createAccountRepositories(db, connection.backend),
      ...createCatalogRepositories(db, connection.backend),
      ...createEntryRepositories(db, connection.backend),
      ...createTimerRepositories(db, connection.backend),
      ...createTransferRepositories(db, connection.backend),
      ...createReportRepositories(db, connection.backend),
    }),
    options,
  );
  const active = new Set<Promise<unknown>>();
  let accepting = true;
  let closing: Promise<void> | undefined;
  function track<T>(work: () => Promise<T>): Promise<T> {
    if (!accepting) return Promise.reject(new Error('Storage is closed'));
    const pending = work();
    active.add(pending);
    void pending.then(
      () => active.delete(pending),
      () => active.delete(pending),
    );
    return pending;
  }
  const runner = {
    transaction<T>(work: (ctx: TransactionContext) => Promise<T>, options?: { dryRun?: boolean }): Promise<T> {
      return track(() => operations.transaction(work, options));
    },
    readSnapshot<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
      return track(() => operations.readSnapshot(work));
    },
  };
  return {
    transaction: runner.transaction,
    readSnapshot: runner.readSnapshot,
    health: () => track(() => connection.health()),
    close: () =>
      (closing ??= (async () => {
        accepting = false;
        while (active.size) await Promise.allSettled([...active]);
        await connection.close();
      })()),
  };
}

/**
 * Rate limit counters outside any other unit of work: each call is its own short transaction, so a
 * password check never runs with a transaction open and every instance on the database sees it.
 */
export function standaloneRateLimits(storage: Pick<Storage, 'transaction'>): RateLimitChecks {
  return {
    reserve: (...args) => storage.transaction(ctx => ctx.rateLimits.reserve(...args)),
    release: (...args) => storage.transaction(ctx => ctx.rateLimits.release(...args)),
    reset: (...args) => storage.transaction(ctx => ctx.rateLimits.reset(...args)),
  };
}
