import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { dirname } from 'node:path';
import { CompiledQuery, SqliteDialect, SqliteDriver, type DatabaseConnection, type SqliteDatabase } from 'kysely';
import { safeInteger } from './conversion.ts';
import type { SqliteConfig } from './config.ts';

function parameters(values: readonly unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (value === null || typeof value === 'string' || value instanceof Uint8Array) return value;
    if (typeof value === 'bigint') return BigInt(safeInteger(value));
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new Error('Invalid SQLite binding');
  });
}
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...row };
  for (const key in row) if (typeof row[key] === 'bigint') normalized[key] = safeInteger(row[key]);
  return normalized;
}

/** Parameter-array and statement metadata bridge; no native SQLite addon is needed. */
function bridge(database: DatabaseSync): SqliteDatabase {
  const prepared = new Map<string, ReturnType<SqliteDatabase['prepare']>>();
  return {
    close: () => { prepared.clear(); database.close(); },
    prepare: (query) => {
      const cached = prepared.get(query);
      if (cached) {
        prepared.delete(query); prepared.set(query, cached);
        return cached;
      }
      const statement = database.prepare(query);
      statement.setReadBigInts(true);
      const result = {
        reader: statement.columns().length > 0,
        all: (values: readonly unknown[]) => statement.all(...parameters(values)).map(normalizeRow),
        run: (values: readonly unknown[]) => {
          const result = statement.run(...parameters(values));
          return { changes: safeInteger(result.changes), lastInsertRowid: safeInteger(result.lastInsertRowid) };
        },
        *iterate(values: readonly unknown[]) {
          // A suspended iterator owns its cursor independently of materialized reads.
          const cursor = database.prepare(query);
          cursor.setReadBigInts(true);
          for (const row of cursor.iterate(...parameters(values))) yield normalizeRow(row);
        },
      };
      prepared.set(query, result);
      // Savepoint names and variable IN lists must not create an unbounded native cache.
      if (prepared.size > 256) prepared.delete(prepared.keys().next().value!);
      return result;
    },
  };
}
class NodeSqliteDriver extends SqliteDriver {
  #readOnly: boolean;
  #queue: Promise<void> = Promise.resolve();
  #release: (() => void) | undefined;
  constructor(database: SqliteDatabase | (() => Promise<SqliteDatabase>), readOnly: boolean) {
    super({ database });
    this.#readOnly = readOnly;
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.#queue;
    this.#queue = new Promise(resolve => { void previous.then(() => { this.#release = resolve; }); });
    await previous;
    return super.acquireConnection();
  }
  override async releaseConnection(): Promise<void> { this.#release?.(); }
  override async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await beginSqliteTransaction(connection, this.#readOnly);
  }
}

/** Internal dialect. A read connection never creates files, directories, or migrations. */
export class NodeSqliteDialect extends SqliteDialect {
  #open: () => Promise<SqliteDatabase>;
  #readOnly: boolean;
  constructor(config: Omit<SqliteConfig, 'backend'>, readOnly = false) {
    const open = async () => {
      if (readOnly && config.filename === ':memory:') throw new Error('In-memory reports require the existing connection');
      if (!readOnly && config.filename !== ':memory:') mkdirSync(dirname(config.filename), { recursive: true });
      const database = new DatabaseSync(config.filename, { readOnly, timeout: config.busyTimeoutMs, enableForeignKeyConstraints: true });
      try {
        if (readOnly) database.exec('PRAGMA query_only = ON');
        else database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL');
        return bridge(database);
      } catch (error) {
        database.close();
        throw error;
      }
    };
    super({ database: open });
    this.#open = open;
    this.#readOnly = readOnly;
  }
  override createDriver(): SqliteDriver { return new NodeSqliteDriver(this.#open, this.#readOnly); }
}

/** A sync busy wait would block the async owner that needs to commit on another handle. */
export async function beginSqliteTransaction(connection: DatabaseConnection, readOnly: boolean): Promise<void> {
  if (readOnly) { await connection.executeQuery(CompiledQuery.raw('BEGIN')); return; }
  const timeout = await connection.executeQuery<{ timeout: number }>(CompiledQuery.raw('PRAGMA busy_timeout'));
  const milliseconds = timeout.rows[0]!.timeout;
  await connection.executeQuery(CompiledQuery.raw('PRAGMA busy_timeout = 0'));
  try {
    const deadline = Date.now() + milliseconds;
    for (;;) {
      try { await connection.executeQuery(CompiledQuery.raw('BEGIN IMMEDIATE')); break; }
      catch (error) {
        if (!(error instanceof Error) || !('errcode' in error) || Number(error.errcode) % 256 !== 5 || Date.now() >= deadline) throw error;
        await setTimeout(5);
      }
    }
  } finally { await connection.executeQuery(CompiledQuery.raw(`PRAGMA busy_timeout = ${milliseconds}`)); }
}
