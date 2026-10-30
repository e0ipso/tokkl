import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CompiledQuery, SqliteDialect, SqliteDriver, type DatabaseConnection, type SqliteDatabase } from 'kysely';
import { safeInteger } from './conversion.ts';
import type { SqliteConfig } from './config.ts';

function parameters(values: readonly unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (value === null || typeof value === 'string' || value instanceof Uint8Array) return value;
    if (typeof value === 'bigint') return BigInt(safeInteger(value));
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return value;
    throw new Error('Invalid SQLite binding');
  });
}
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? safeInteger(value) : value]));
}

/** Parameter-array and statement metadata bridge; no native SQLite addon is needed. */
function bridge(database: DatabaseSync): SqliteDatabase {
  return {
    close: () => database.close(),
    prepare: (query) => {
      const statement = database.prepare(query);
      statement.setReadBigInts(true);
      return {
        reader: statement.columns().length > 0,
        all: (values) => statement.all(...parameters(values)).map(normalizeRow),
        run: (values) => {
          const result = statement.run(...parameters(values));
          return { changes: safeInteger(result.changes), lastInsertRowid: safeInteger(result.lastInsertRowid) };
        },
        *iterate(values) {
          for (const row of statement.iterate(...parameters(values))) yield normalizeRow(row);
        },
      };
    },
  };
}
class NodeSqliteDriver extends SqliteDriver {
  #readOnly: boolean;
  constructor(database: SqliteDatabase | (() => Promise<SqliteDatabase>), readOnly: boolean) {
    super({ database });
    this.#readOnly = readOnly;
  }
  override async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(this.#readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE'));
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
