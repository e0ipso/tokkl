import { readFileSync } from 'node:fs';
import pg, { type PoolConfig } from 'pg';
import mysql, { type PoolOptions } from 'mysql2';
import { Kysely, MysqlDialect, PostgresDialect, sql, type Dialect, type MysqlPool, type MysqlPoolConnection, type MysqlQueryResult } from 'kysely';
import { utcSqlInstant } from './conversion.ts';
import { NodeSqliteDialect } from './sqliteBridge.ts';
import { safeDestination, type ServerConfig, type StorageConfig } from './config.ts';

export class StorageConnectionError extends Error {
  constructor(operation: 'open' | 'health' | 'close', backend: StorageConfig['backend']) {
    super(`Storage ${operation} failed (${backend})`);
    this.name = 'StorageConnectionError';
  }
}
function ca(config: ServerConfig): { ca?: string } {
  return config.tls.mode === 'verify-full' && config.tls.caFile ? { ca: readFileSync(config.tls.caFile, 'utf8') } : {};
}
/** Internal driver options. Never pass the original URL to a driver or log this object. */
export function postgresOptions(config: ServerConfig, readOnly: boolean): PoolConfig {
  return {
    host: config.host, port: config.port, database: config.database, user: config.user, password: () => config.password,
    sslnegotiation: 'postgres', client_encoding: 'UTF8', application_name: 'tokkl',
    max: readOnly ? 1 : config.poolMax, connectionTimeoutMillis: config.connectTimeoutMs,
    idleTimeoutMillis: 10000, statement_timeout: config.queryTimeoutMs, query_timeout: config.queryTimeoutMs,
    options: `-c timezone=UTC${readOnly ? ' -c default_transaction_read_only=on' : ''}`,
    ssl: config.tls.mode === 'disable' ? false : { ...ca(config), rejectUnauthorized: true },
    // Per-pool parsers avoid global pg type mutations and preserve BIGINT/NUMERIC until mapping.
    types: { getTypeParser: (oid, format) => {
      if (oid === 1114 || oid === 1184) return utcSqlInstant;
      return [20, 1700, 1082, 114, 3802].includes(oid) ? (value: string) => value : pg.types.getTypeParser(oid, format);
    } },
  };
}
export function mysqlOptions(config: ServerConfig, readOnly: boolean): PoolOptions {
  return {
    host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
    connectionLimit: readOnly ? 1 : config.poolMax, maxIdle: readOnly ? 1 : config.poolMax,
    connectTimeout: config.connectTimeoutMs, idleTimeout: 10000,
    // Fail on overload instead of leaving an unbounded or indefinitely waiting acquisition queue.
    waitForConnections: false, queueLimit: config.poolMax,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
    dateStrings: true, jsonStrings: true, timezone: 'Z', charset: 'utf8mb4',
    multipleStatements: false, enableKeepAlive: true,
    ssl: config.tls.mode === 'disable' ? undefined : { ...ca(config), rejectUnauthorized: true, verifyIdentity: true },
  };
}

/** MySQL and MariaDB share the protocol driver, but retain distinct backend configuration identity. */
function mysqlPool(config: ServerConfig, readOnly: boolean): MysqlPool {
  const pool = mysql.createPool(mysqlOptions(config, readOnly));
  const connections = new WeakMap<object, MysqlPoolConnection>();
  return {
    end: (callback) => pool.end(callback),
    getConnection: (callback) => pool.getConnection((error, raw) => {
      if (error) { callback(error, undefined!); return; }
      const known = connections.get(raw);
      if (known) { callback(null, known); return; }
      const connection: MysqlPoolConnection = {
        config: raw.config,
        threadId: raw.threadId,
        connect: (done) => raw.connect(done),
        destroy: () => raw.destroy(),
        release: () => raw.release(),
        query: (query, parameters, done) => raw.query({ sql: query, timeout: config.queryTimeoutMs }, parameters,
          done ? (failure, result) => {
            // A timeout makes connection state uncertain. Never return it to the pool.
            if (failure && failure.code === 'PROTOCOL_SEQUENCE_TIMEOUT') raw.destroy();
            done(failure, result as MysqlQueryResult);
          } : undefined),
      };
      // Initialize before exposing the connection; errors destroy it rather than leaking a checkout.
      const initialize = async () => {
        const execute = (query: string) => new Promise<void>((resolve, reject) => {
          raw.query({ sql: query, timeout: config.queryTimeoutMs }, (failure) => failure ? reject(failure) : resolve());
        });
        await execute("SET time_zone = '+00:00'");
        if (readOnly) await execute('SET SESSION TRANSACTION READ ONLY');
      };
      void initialize().then(() => {
        connections.set(raw, connection);
        callback(null, connection);
      }, (failure: unknown) => {
        raw.destroy();
        callback(failure, undefined!);
      });
    }),
  };
}

/** Storage-internal only. Application code depends on Storage in contracts.ts, never this handle. */
export interface StorageConnection<Database> {
  readonly db: Kysely<Database>;
  readonly backend: StorageConfig['backend'];
  readonly destination: string;
  readonly readOnly: boolean;
  health(): Promise<void>;
  close(): Promise<void>;
}

/** Opens and probes without running migrations or constructing repositories. No fallback path exists. */
export async function openConnection<Database = Record<string, never>>(config: StorageConfig, readOnly = false): Promise<StorageConnection<Database>> {
  let db: Kysely<Database> | undefined;
  try {
    let dialect: Dialect;
    if (config.backend === 'sqlite') dialect = new NodeSqliteDialect(config, readOnly);
    else if (config.backend === 'postgres') {
      const pool = new pg.Pool(postgresOptions(config, readOnly));
      // An idle socket error must not crash the process or log driver credentials. The next health
      // check/query establishes availability; pg removes failed idle clients from the pool.
      pool.on('error', () => {});
      dialect = new PostgresDialect({ pool });
    } else {
      dialect = new MysqlDialect({ pool: mysqlPool(config, readOnly) });
    }
    db = new Kysely<Database>({ dialect });
    await sql`select 1 as healthy`.execute(db);
    const connection = db;
    let closing: Promise<void> | undefined;
    return {
      db: connection, backend: config.backend, destination: safeDestination(config), readOnly,
      async health() {
        try {
          if (closing) throw new Error('closed');
          await sql`select 1 as healthy`.execute(connection);
        } catch { throw new StorageConnectionError('health', config.backend); }
      },
      close() {
        closing ??= connection.destroy().catch(() => { throw new StorageConnectionError('close', config.backend); });
        return closing;
      },
    };
  } catch {
    try { await db?.destroy(); } catch { /* Preserve a redacted open error even if cleanup also fails. */ }
    throw new StorageConnectionError('open', config.backend);
  }
}

/** One network reader per worker. SQLite files are opened read-only; memory uses the caller inline. */
export function openReadConnection<Database = Record<string, never>>(config: StorageConfig): Promise<StorageConnection<Database>> {
  return openConnection<Database>(config, true);
}
