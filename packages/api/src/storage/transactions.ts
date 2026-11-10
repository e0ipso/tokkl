import { sql, type Kysely } from 'kysely';
import type { Backend } from './config.ts';
import type { StorageConnection } from './connections.ts';
import type { OperationContext, TransactionScope } from '../domain/ports.ts';
import { StorageConflict } from '../domain/ports.ts';
import { classifyConflict, StorageTransactionError } from './errors.ts';
import { beginSqliteTransaction } from './sqliteBridge.ts';

/** Internal: build every repository on this exact connection-bound db. */
type RepositoryFactory<D, R extends object> = (db: Kysely<D>) => R;
interface TransactionOptions {
  dryRun?: boolean;
}
interface TransactionRunner<R extends object> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>, options?: TransactionOptions): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
export interface TransactionRunnerOptions {
  /** The write has committed, so a throwing after-commit callback is only reported; a throwing reporter is ignored. */
  afterCommitFailed?: (error: unknown) => void;
}

/** Attempts in all when each but the last hits a retryable conflict. */
const MAX_ATTEMPTS = 3;
/** Ceiling of the first rerun's wait; the second doubles it. */
const RETRY_BASE_DELAY_MS = 10;

/** Half the doubled ceiling plus a random share, so conflicting transactions rerun apart: 5-10, then 10-20 ms. */
function waitBeforeRetry(failed: number): Promise<void> {
  const ceiling = RETRY_BASE_DELAY_MS * 2 ** (failed - 1);
  const delay = ceiling / 2 + (Math.random() * ceiling) / 2;
  return new Promise(resolve => setTimeout(resolve, delay));
}

type Hook = () => Promise<void>;
/** Hooks registered by hooks count, so mutual registration fails instead of looping. */
const MAX_BEFORE_COMMIT_HOOKS = 1000;
/** Lock ranks: the instance guard, then workspaces, then users, each group in ascending id order. */
const INSTANCE_RANK = '0';
const TABLE_RANK = { workspaces: '1', users: '2' } as const;

const execute = <D>(db: Kysely<D>, command: string) => sql.raw(command).execute(db);

async function begin<D>(db: Kysely<D>, backend: Backend, snapshot: boolean): Promise<void> {
  if (backend === 'sqlite') {
    await db.getExecutor().provideConnection(c => beginSqliteTransaction(c, snapshot));
  } else if (backend === 'postgres') {
    await execute(
      db,
      snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED',
    );
  } else {
    await execute(db, `SET TRANSACTION ISOLATION LEVEL ${snapshot ? 'REPEATABLE READ' : 'READ COMMITTED'}`);
    await execute(db, snapshot ? 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' : 'START TRANSACTION');
  }
}

/** Refuses every query once the operation that handed out `db` has ended. */
function scoped<D>(db: Kysely<D>, isActive: () => boolean): Kysely<D> {
  return db.withPlugin({
    transformQuery(args) {
      if (!isActive()) throw new Error('Operation context is closed');
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  });
}

/** Acquisitions follow the global order across all calls, so two transactions never wait in a cycle. */
class LockOrder<D> {
  #held = new Set<string>();
  #lastRank = '';
  #queue: Promise<void> = Promise.resolve();
  readonly #db: Kysely<D>;
  readonly #backend: Backend;
  readonly #check: () => void;

  constructor(db: Kysely<D>, backend: Backend, check: () => void) {
    this.#db = db;
    this.#backend = backend;
    this.#check = check;
  }

  #serialize(work: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(work);
    this.#queue = next.catch(() => {});
    return next;
  }

  #forUpdate() {
    return this.#backend === 'sqlite' ? sql`` : sql`for update`;
  }

  rows(table: keyof typeof TABLE_RANK, ids: number[]): Promise<void> {
    return this.#serialize(async () => {
      this.#check();
      const ordered = [...new Set(ids)].sort((a, b) => a - b);
      for (const id of ordered) {
        if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid lock identity');
        const key = `${TABLE_RANK[table]}:${String(id).padStart(16, '0')}`;
        if (this.#held.has(key)) continue;
        if (key < this.#lastRank) throw new Error('Storage lock order violation');
        const result = await sql`select id from ${sql.table(table)} where id = ${id} ${this.#forUpdate()}`.execute(
          this.#db,
        );
        // A row gone by now was deleted by a transaction this one waited for: rerun so discovery sees the deletion.
        if (result.rows.length !== 1) throw new StorageConflict('serialization');
        this.#held.add(key);
        this.#lastRank = key;
      }
    });
  }

  instance(): Promise<void> {
    return this.#serialize(async () => {
      this.#check();
      if (this.#held.has(INSTANCE_RANK)) return;
      if (this.#lastRank && this.#lastRank !== INSTANCE_RANK) throw new Error('Storage lock order violation');
      // Every initialized database has this immutable parent, even before the first user.
      const result = await sql`select version from storage_migrations where version = 1 ${this.#forUpdate()}`.execute(
        this.#db,
      );
      if (result.rows.length !== 1) throw new Error('Storage guard is missing');
      this.#held.add(INSTANCE_RANK);
      this.#lastRank = INSTANCE_RANK;
    });
  }

  /** Keeps the high-water rank: InnoDB may keep locks after a savepoint; PostgreSQL retakes released rows. */
  savedHeld(): Set<string> {
    return new Set(this.#held);
  }

  restoreHeld(held: Set<string>): void {
    this.#held = held;
  }
}

interface Attempt {
  /** Keyed, so each runs once however often it is registered. */
  before: Map<string, Hook>;
  /** Run after the last before-commit hook, so they read the settled state. */
  reads: Hook[];
  /** Run after COMMIT and release. */
  after: Hook[];
  /** A savepoint could not roll back, so the transaction must not commit. */
  rollbackOnly: boolean;
  /** Bulk entry patches and import rows each run in one. */
  savepointActive: boolean;
}

async function readAtCommit(attempt: Attempt): Promise<void> {
  for (const read of attempt.reads.splice(0)) await read();
  if (attempt.before.size || attempt.reads.length) throw new Error('A read at commit registered more work');
}

/** A hook may register more: an entry write in a hook touches its user's timer again, which must follow it. */
async function drainBeforeCommit(attempt: Attempt): Promise<void> {
  let drained = 0;
  while (attempt.before.size) {
    if (++drained > MAX_BEFORE_COMMIT_HOOKS) throw new Error('Before-commit hooks did not settle');
    const [key, callback] = attempt.before.entries().next().value!;
    attempt.before.delete(key);
    await callback();
  }
}

/** Callbacks run in order after release; a failure goes to `afterCommitFailed` and the next still runs. */
async function runAfterCommit(after: Hook[], options: TransactionRunnerOptions): Promise<void> {
  for (const callback of after) {
    try {
      await callback();
    } catch (error) {
      try {
        options.afterCommitFailed?.(error);
      } catch {
        /* committed writes remain successful */
      }
    }
  }
}

function createScope<D, R extends object>(
  db: Kysely<D>,
  attempt: Attempt,
  locks: LockOrder<D>,
  check: () => void,
  context: () => OperationContext<R>,
): TransactionScope<R> {
  return {
    async savepoint(unit) {
      check();
      // A connection has a stack of savepoints. Concurrent sibling units cannot share it.
      if (attempt.savepointActive) throw new Error('Savepoints must be sequential');
      attempt.savepointActive = true;
      // The sequential guard permits reuse after release and bounds native statements.
      const name = 'storage_sp_1';
      const savedBefore = new Map(attempt.before);
      const savedReads = attempt.reads.length;
      const savedAfter = attempt.after.length;
      const savedHeld = locks.savedHeld();
      await execute(db, `SAVEPOINT ${name}`);
      try {
        const result = await unit(context());
        await execute(db, `RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        attempt.before = savedBefore;
        attempt.reads.length = savedReads;
        attempt.after.length = savedAfter;
        locks.restoreHeld(savedHeld);
        try {
          await execute(db, `ROLLBACK TO SAVEPOINT ${name}`);
          await execute(db, `RELEASE SAVEPOINT ${name}`);
        } catch {
          attempt.rollbackOnly = true;
        }
        throw classifyConflict(error) ?? error;
      } finally {
        attempt.savepointActive = false;
      }
    },
    beforeCommit(key, callback) {
      check();
      attempt.before.set(key, callback);
    },
    readAtCommit(read) {
      check();
      attempt.reads.push(read);
    },
    afterCommit(callback) {
      check();
      attempt.after.push(callback);
    },
    lockUserTimer: id => locks.rows('users', [id]),
    lockUsers: ids => locks.rows('users', ids),
    lockWorkspaces: ids => locks.rows('workspaces', ids),
    lockInstanceAdministration: () => locks.instance(),
  };
}

export function createTransactionRunner<D, R extends object>(
  connection: StorageConnection<D>,
  factory: RepositoryFactory<D, R>,
  options: TransactionRunnerOptions = {},
): TransactionRunner<R> {
  const backend = connection.backend;

  async function attemptOnce<T>(
    work: (context: OperationContext<R>) => Promise<T>,
    settings: TransactionOptions,
    attempt: Attempt,
    outcome: { rolledBack: boolean; commitStarted: boolean },
  ): Promise<T> {
    return connection.db.connection().execute(async db => {
      let began = false;
      let bodyStarted = false;
      let active = true;
      const check = () => {
        if (!active) throw new Error('Transaction context is closed');
      };
      const locks = new LockOrder(db, backend, check);
      const context: OperationContext<R> = Object.assign(
        factory(scoped(db, () => active)),
        createScope<D, R>(db, attempt, locks, check, () => context),
      );
      try {
        began = true;
        await begin(db, backend, false);
        bodyStarted = true;
        const result = await work(context);
        await drainBeforeCommit(attempt);
        await readAtCommit(attempt);
        if (attempt.rollbackOnly || attempt.savepointActive) throw new Error('Transaction cannot commit');
        if (settings.dryRun) {
          await execute(db, 'ROLLBACK');
          outcome.rolledBack = true;
          attempt.after.length = 0;
        } else {
          outcome.commitStarted = true;
          await execute(db, 'COMMIT');
        }
        return result;
      } catch (error) {
        attempt.after.length = 0;
        // SQLite's synchronous BEGIN reports BUSY before it opens a transaction.
        // Rolling back here would replace the useful conflict with 'no transaction'.
        if (backend === 'sqlite' && !bodyStarted && classifyConflict(error)?.kind === 'busy')
          throw classifyConflict(error)!;
        if (began) {
          try {
            await execute(db, 'ROLLBACK');
            outcome.rolledBack = true;
          } catch {
            throw new StorageTransactionError('unknown');
          }
        }
        if (outcome.commitStarted) throw new StorageTransactionError('unknown');
        throw classifyConflict(error) ?? error;
      } finally {
        active = false;
      }
    });
  }

  return {
    async transaction(work, settings = {}) {
      if (connection.readOnly) throw new Error('Write transaction requires a writable connection');
      for (let number = 1; ; number++) {
        const attempt: Attempt = {
          before: new Map(),
          reads: [],
          after: [],
          rollbackOnly: false,
          savepointActive: false,
        };
        const outcome = { rolledBack: false, commitStarted: false };
        try {
          const value = await attemptOnce(work, settings, attempt, outcome);
          // connection().execute has released the checkout before any callback can read storage.
          await runAfterCommit(attempt.after, options);
          return value;
        } catch (error) {
          // Only a rolled-back deadlock or serialization failure is safe to run again.
          const conflict = classifyConflict(error);
          const retryable =
            !outcome.commitStarted &&
            outcome.rolledBack &&
            !!conflict &&
            (conflict.kind === 'deadlock' || conflict.kind === 'serialization');
          if (!retryable || number >= MAX_ATTEMPTS) throw error;
          await waitBeforeRetry(number);
        }
      }
    },
    async readSnapshot(work) {
      return connection.db.connection().execute(async db => {
        let active = true;
        let queryOnly: number | undefined;
        if (backend === 'sqlite') {
          queryOnly = Number((await sql<{ query_only: number }>`PRAGMA query_only`.execute(db)).rows[0]!.query_only);
          await execute(db, 'PRAGMA query_only = ON');
        }
        try {
          await begin(db, backend, true);
          const result = await work(factory(scoped(db, () => active)));
          await execute(db, 'COMMIT');
          return result;
        } catch (error) {
          try {
            await execute(db, 'ROLLBACK');
          } catch {
            throw new StorageTransactionError('unknown');
          }
          throw classifyConflict(error) ?? error;
        } finally {
          active = false;
          if (queryOnly !== undefined) await execute(db, `PRAGMA query_only = ${queryOnly}`);
        }
      });
    },
  };
}
