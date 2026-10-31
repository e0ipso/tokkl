import { sql, type Kysely } from 'kysely';
import type { StorageConnection } from './connections.ts';
import type { OperationContext, TransactionScope } from './contracts.ts';
import { classifyConflict, StorageTransactionError } from './errors.ts';
import { beginSqliteTransaction } from './sqliteBridge.ts';

/** Internal only: construct ALL repositories using this exact connection-bound db. */
export type RepositoryFactory<D, R extends object> = (db: Kysely<D>) => R;
export interface TransactionOptions { maxAttempts?: number; dryRun?: boolean }
export interface TransactionRunner<R extends object> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>, options?: TransactionOptions): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
export interface TransactionRunnerOptions {
  /** Error details are deliberately omitted. Reporting must never fail an already committed write. */
  publicationFailed?: () => void | Promise<void>;
}

export function createTransactionRunner<D, R extends object>(connection: StorageConnection<D>, factory: RepositoryFactory<D, R>, options: TransactionRunnerOptions = {}): TransactionRunner<R> {
  const backend = connection.backend;
  function scoped(db: Kysely<D>, isActive: () => boolean): Kysely<D> {
    return db.withPlugin({
      transformQuery(args) {
        if (!isActive()) throw new Error('Operation context is closed');
        return args.node;
      },
      async transformResult(args) { return args.result; },
    });
  }
  const execute = (db: Kysely<D>, command: string) => sql.raw(command).execute(db);
  async function begin(db: Kysely<D>, snapshot: boolean) {
    if (backend === 'sqlite') {
      await db.getExecutor().provideConnection(c => beginSqliteTransaction(c, snapshot));
    } else if (backend === 'postgres') {
      await execute(db, snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED');
    } else {
      await execute(db, `SET TRANSACTION ISOLATION LEVEL ${snapshot ? 'REPEATABLE READ' : 'READ COMMITTED'}`);
      await execute(db, snapshot ? 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' : 'START TRANSACTION');
    }
  }
  return {
    async transaction(work, settings = {}) {
      if (connection.readOnly) throw new Error('Write transaction requires a writable connection');
      const attempts = settings.maxAttempts ?? 3;
      if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Invalid transaction attempt limit');
      for (let attempt = 1; ; attempt++) {
        let rolledBack = false;
        let commitStarted = false;
        const after: Array<() => Promise<void>> = [];
        try {
          const value = await connection.db.connection().execute(async db => {
            let began = false;
            let bodyStarted = false;
            let active = true;
            let rollbackOnly = false;
            let savepointActive = false;
            let before = new Map<string, () => Promise<void>>();
            let held = new Set<string>();
            let lastRank = '';
            function check() { if (!active) throw new Error('Transaction context is closed'); }
            let lockQueue: Promise<void> = Promise.resolve();
            function serializeLock(work: () => Promise<void>): Promise<void> {
              const next = lockQueue.then(work);
              lockQueue = next.catch(() => {});
              return next;
            }
            function locks(table: 'users' | 'workspaces', ids: number[]): Promise<void> {
              return serializeLock(async () => {
                check();
                const rank = table === 'workspaces' ? '1' : '2';
                const ordered = [...new Set(ids)].sort((a, b) => a - b);
                for (const id of ordered) {
                  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid lock identity');
                  const key = `${rank}:${String(id).padStart(16, '0')}`;
                  if (held.has(key)) continue;
                  if (key < lastRank) throw new Error('Storage lock order violation');
                  const result = await sql`select id from ${sql.table(table)} where id = ${id} ${backend === 'sqlite' ? sql`` : sql`for update`}`.execute(db);
                  if (result.rows.length !== 1) throw new Error('Storage lock target does not exist');
                  held.add(key); lastRank = key;
                }
              });
            }
            const scope: TransactionScope<R> = {
              async transaction(nested) { check(); return nested(context); },
              async savepoint(unit) {
                check();
                // A connection has a stack of savepoints. Concurrent sibling units cannot share it.
                if (savepointActive) throw new Error('Savepoints must be sequential');
                savepointActive = true;
                // The sequential guard permits reuse after release and bounds native statements.
                const name = 'storage_sp_1';
                const savedBefore = new Map(before);
                const savedAfter = after.length;
                const savedHeld = new Set(held);
                await execute(db, `SAVEPOINT ${name}`);
                try {
                  const result = await unit(context);
                  await execute(db, `RELEASE SAVEPOINT ${name}`);
                  return result;
                } catch (error) {
                  before = savedBefore; after.length = savedAfter;
                  held = savedHeld;
                  // InnoDB can retain locks acquired after a savepoint. Keep the high-water order
                  // on every engine; PostgreSQL must reacquire rows released by rollback.
                  try {
                    await execute(db, `ROLLBACK TO SAVEPOINT ${name}`);
                    await execute(db, `RELEASE SAVEPOINT ${name}`);
                  } catch { rollbackOnly = true; }
                  throw classifyConflict(error) ?? error;
                } finally { savepointActive = false; }
              },
              beforeCommit(key, callback) { check(); before.set(key, callback); },
              afterCommit(callback) { check(); after.push(callback); },
              lockUserTimer: id => locks('users', [id]),
              lockUsers: ids => locks('users', ids),
              lockWorkspaces: ids => locks('workspaces', ids),
              lockInstanceAdministration() {
                return serializeLock(async () => {
                  check();
                  if (held.has('0')) return;
                  if (lastRank && lastRank !== '0') throw new Error('Storage lock order violation');
                  // Every initialized database has this immutable parent, even before the first user.
                  const result = await sql`select version from storage_migrations where version = 1 ${backend === 'sqlite' ? sql`` : sql`for update`}`.execute(db);
                  if (result.rows.length !== 1) throw new Error('Storage guard is missing');
                  held.add('0'); lastRank = '0';
                });
              },
            };
            const context: OperationContext<R> = Object.assign(factory(scoped(db, () => active)), scope);
            try {
              began = true; await begin(db, false); bodyStarted = true;
              const result = await work(context);
              let drained = 0;
              while (before.size) {
                if (++drained > 1000) throw new Error('Before-commit hooks did not settle');
                const [key, callback] = before.entries().next().value!;
                before.delete(key);
                await callback();
              }
              if (rollbackOnly || savepointActive) throw new Error('Transaction cannot commit');
              if (settings.dryRun) {
                await execute(db, 'ROLLBACK'); rolledBack = true; after.length = 0;
              } else {
                commitStarted = true;
                await execute(db, 'COMMIT');
              }
              return result;
            } catch (error) {
              after.length = 0;
              // SQLite's synchronous BEGIN reports BUSY before it opens a transaction.
              // Rolling back here would replace the useful conflict with 'no transaction'.
              if (backend === 'sqlite' && !bodyStarted && classifyConflict(error)?.kind === 'busy') throw classifyConflict(error)!;
              if (began) {
                try { await execute(db, 'ROLLBACK'); rolledBack = true; }
                catch { throw new StorageTransactionError('unknown'); }
              }
              if (commitStarted) throw new StorageTransactionError('unknown');
              throw classifyConflict(error) ?? error;
            } finally { active = false; }
          });
          // connection().execute has released the checkout before any callback can read storage.
          for (const publish of after) {
            try { await publish(); }
            catch { try { await options.publicationFailed?.(); } catch { /* committed writes remain successful */ } }
          }
          return value;
        } catch (error) {
          const conflict = classifyConflict(error);
          if (!commitStarted && rolledBack && conflict && ['deadlock', 'serialization'].includes(conflict.kind) && attempt < attempts) continue;
          throw error;
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
          await begin(db, true);
          const result = await work(factory(scoped(db, () => active)));
          await execute(db, 'COMMIT');
          return result;
        } catch (error) {
          try { await execute(db, 'ROLLBACK'); } catch { throw new StorageTransactionError('unknown'); }
          throw classifyConflict(error) ?? error;
        } finally {
          active = false;
          if (queryOnly !== undefined) await execute(db, `PRAGMA query_only = ${queryOnly}`);
        }
      });
    },
  };
}
