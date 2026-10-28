import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalTimeZone } from '@tokkl/common/time';
import { MIGRATIONS } from './migrations.ts';

export type Db = DatabaseSync;
export type Row = Record<string, unknown>;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  registerFunctions(db);
  migrate(db);
  return db;
}

/** SQL functions that migrations and queries may call. Register them before migrate() runs. */
function registerFunctions(db: Db): void {
  // NULL for values canonicalTimeZone rejects (offset IDs, unknown names) and for non-text values.
  db.function('canonical_time_zone', { deterministic: true }, (name) =>
    typeof name === 'string' ? canonicalTimeZone(name) : null);
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/** Callbacks registered on the outermost transaction() running on a database. */
interface CommitHooks {
  /** Run after the transaction's work and before COMMIT, one per key, in the order first registered. */
  before: Map<string, () => void>;
  /** Run after COMMIT, in the order registered. */
  after: Array<() => void>;
}

const commitHooks = new WeakMap<Db, CommitHooks>();

function hooksOf(db: Db, caller: string): CommitHooks {
  const hooks = commitHooks.get(db);
  if (!hooks) throw new Error(`${caller} needs a transaction() in progress`);
  return hooks;
}

/**
 * Runs `fn` inside the transaction() in progress, after the rest of its work and just before
 * COMMIT, so `fn` sees the final rows and may still write. If `fn` throws, the transaction rolls
 * back. Later calls with the same key in the same transaction do nothing. A rollback drops it.
 */
export function beforeCommit(db: Db, key: string, fn: () => void): void {
  const { before } = hooksOf(db, 'beforeCommit');
  if (!before.has(key)) before.set(key, fn);
}

/**
 * Runs `fn` once the transaction() in progress has committed, outside any transaction. A rollback
 * drops it. The commit stands whatever `fn` does, so an error it throws is logged, not raised.
 */
export function afterCommit(db: Db, fn: () => void): void {
  hooksOf(db, 'afterCommit').after.push(fn);
}

/**
 * Runs `fn` inside a transaction. Nested calls join the outer transaction. The outermost call runs
 * the beforeCommit callbacks just before COMMIT and the afterCommit callbacks just after it.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  const hooks: CommitHooks = { before: new Map(), after: [] };
  commitHooks.set(db, hooks);
  let result: T;
  try {
    result = fn();
    // Map iteration also visits keys added while it runs, so a callback may register another.
    for (const callback of hooks.before.values()) callback();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    commitHooks.delete(db);
  }
  for (const callback of hooks.after) {
    try {
      callback();
    } catch (error) {
      console.error(error);
    }
  }
  return result;
}

export function nowIso(): string {
  return new Date().toISOString();
}
