import { readFileSync } from 'node:fs';
import { connect, isIP } from 'node:net';
import { checkServerIdentity, TLSSocket } from 'node:tls';
import pg, { type PoolConfig } from 'pg';
import mysql, { type PoolConnection, type PoolOptions } from 'mysql2';
import {
  Kysely,
  MysqlDialect,
  PostgresDialect,
  sql,
  type Dialect,
  type MysqlPool,
  type MysqlPoolConnection,
  type MysqlQueryResult,
} from 'kysely';
import { StorageTransactionError } from './errors.ts';
import { utcSqlInstant } from './conversion.ts';
import { NodeSqliteDialect } from './sqliteBridge.ts';
import { safeDestination, type ServerConfig, type StorageConfig } from './config.ts';

export class StorageConnectionError extends Error {
  constructor(operation: 'open' | 'health' | 'close', backend: StorageConfig['backend']) {
    super(`Storage ${operation} failed (${backend})`);
    this.name = 'StorageConnectionError';
  }
}
const IDLE_TIMEOUT_MS = 10_000;
/** Waiters per pooled MySQL connection; past it acquisition fails at once. */
const QUEUED_PER_CONNECTION = 20;
/** Read as UTC instants. */
const TIMESTAMP_OIDS = [1114, 1184];
/** Kept as text until mapping. */
const TEXT_OIDS = [20, 1700, 1082, 114, 3802];

function ca(config: ServerConfig): { ca?: string } {
  return config.tls.mode === 'verify-full' && config.tls.caFile ? { ca: readFileSync(config.tls.caFile, 'utf8') } : {};
}
/** Never pass the original URL to a driver or log this object. */
export function postgresOptions(config: ServerConfig, readOnly: boolean): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: () => config.password,
    sslnegotiation: 'postgres',
    client_encoding: 'UTF8',
    application_name: 'tokkl',
    max: readOnly ? 1 : config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: config.queryTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    options: `-c timezone=UTC${readOnly ? ' -c default_transaction_read_only=on' : ''}`,
    ssl: config.tls.mode === 'disable' ? false : { ...ca(config), rejectUnauthorized: true },
    // Per-pool parsers avoid global pg type mutations and preserve BIGINT/NUMERIC until mapping.
    types: {
      getTypeParser: (oid, format) => {
        if (TIMESTAMP_OIDS.includes(oid)) return utcSqlInstant;
        return TEXT_OIDS.includes(oid) ? (value: string) => value : pg.types.getTypeParser(oid, format);
      },
    },
  };
}
export function mysqlOptions(config: ServerConfig, readOnly: boolean): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: readOnly ? 1 : config.poolMax,
    maxIdle: readOnly ? 1 : config.poolMax,
    connectTimeout: config.connectTimeoutMs,
    idleTimeout: IDLE_TIMEOUT_MS,
    // Ordinary request bursts wait; both queue capacity and acquisition time remain bounded.
    waitForConnections: true,
    queueLimit: QUEUED_PER_CONNECTION * (readOnly ? 1 : config.poolMax),
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: true,
    jsonStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
    multipleStatements: false,
    enableKeepAlive: true,
    ssl: config.tls.mode === 'disable' ? undefined : { ...ca(config), rejectUnauthorized: true, verifyIdentity: true },
  };
}

type CheckoutCallback = Parameters<MysqlPool['getConnection']>[0];

/** net.connect leaves _host unset for IPs, so mysql2's TLS would verify against localhost; this keeps the IP. */
function ipHostSocket(config: ServerConfig): Pick<PoolOptions, 'stream'> {
  if (config.tls.mode !== 'verify-full' || !isIP(config.host)) return {};
  return {
    stream: () => {
      const socket = connect({ host: config.host, port: config.port, noDelay: true, keepAlive: true });
      Object.assign(socket, { _host: config.host });
      return socket;
    },
  };
}

/** mysql2 omits SNI for IP addresses, so verify the identity on every checkout, resumed sessions included. */
function tlsIdentityFailure(config: ServerConfig, raw: PoolConnection): Error | undefined {
  if (config.tls.mode !== 'verify-full') return undefined;
  const stream = (raw as unknown as { stream?: TLSSocket }).stream;
  return !(stream instanceof TLSSocket) || !stream.authorized
    ? new Error('Storage TLS verification failed')
    : checkServerIdentity(config.host, stream.getPeerCertificate(true));
}

/** Every query carries the query timeout. */
function kyselyConnection(raw: PoolConnection, queryTimeoutMs: number): MysqlPoolConnection {
  return {
    config: raw.config,
    threadId: raw.threadId,
    connect: done => raw.connect(done),
    destroy: () => raw.destroy(),
    release: () => raw.release(),
    query: (query, parameters, done) =>
      raw.query(
        { sql: query, timeout: queryTimeoutMs },
        parameters,
        done
          ? (failure, result) => {
              // A timeout makes connection state uncertain. Never return it to the pool.
              if (
                failure &&
                (failure.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /^(COMMIT|ROLLBACK)$/i.test(query.trim()))
              )
                raw.destroy();
              done(failure, result as MysqlQueryResult);
            }
          : undefined,
      ),
  };
}

async function initializeSession(raw: PoolConnection, queryTimeoutMs: number, readOnly: boolean): Promise<void> {
  const execute = (query: string) =>
    new Promise<void>((resolve, reject) => {
      raw.query({ sql: query, timeout: queryTimeoutMs }, failure => (failure ? reject(failure) : resolve()));
    });
  await execute("SET time_zone = '+00:00'");
  if (readOnly) await execute('SET SESSION TRANSACTION READ ONLY');
}

/** MySQL and MariaDB share the driver but keep distinct backend identity. */
function mysqlPool(config: ServerConfig, readOnly: boolean): MysqlPool {
  const pool = mysql.createPool({ ...mysqlOptions(config, readOnly), ...ipHostSocket(config) });
  const connections = new WeakMap<object, MysqlPoolConnection>();

  /** Initializes a checkout the first time it is seen. */
  function expose(raw: PoolConnection, callback: CheckoutCallback): void {
    const failure = tlsIdentityFailure(config, raw);
    if (failure) {
      raw.destroy();
      callback(failure, undefined!);
      return;
    }
    const known = connections.get(raw);
    if (known) {
      callback(null, known);
      return;
    }
    const connection = kyselyConnection(raw, config.queryTimeoutMs);
    // Errors destroy the connection rather than leaking a checkout.
    void initializeSession(raw, config.queryTimeoutMs, readOnly).then(
      () => {
        connections.set(raw, connection);
        callback(null, connection);
      },
      (error: unknown) => {
        raw.destroy();
        callback(error, undefined!);
      },
    );
  }

  return {
    end: callback => pool.end(callback),
    getConnection: callback => {
      let settled = false;
      const deadline = setTimeout(() => {
        settled = true;
        callback(new Error('Storage connection acquisition timed out'), undefined!);
      }, config.connectTimeoutMs);
      pool.getConnection((error, raw) => {
        // A timed-out waiter still belongs to the driver's finite queue until delivery.
        // Release any late checkout instead of leaking it or running abandoned work.
        if (settled) {
          raw?.release();
          return;
        }
        settled = true;
        clearTimeout(deadline);
        if (error) {
          callback(error, undefined!);
          return;
        }
        expose(raw, callback);
      });
    },
  };
}

/** Discarded after a failed COMMIT/ROLLBACK or a timeout, so no transaction state reaches another operation. */
function guardedPostgresClient(raw: pg.PoolClient): pg.PoolClient {
  let poisoned = false;
  return new Proxy(raw, {
    get(target, property) {
      if (property === 'release') return () => raw.release(poisoned);
      if (property === 'query')
        return async (query: string, parameters: readonly unknown[]) => {
          try {
            const result = await raw.query(query, [...parameters]);
            // PostgreSQL answers COMMIT with ROLLBACK when an error was swallowed.
            if (/^COMMIT$/i.test(query.trim()) && result.command !== 'COMMIT')
              throw new StorageTransactionError('rolled-back');
            return result;
          } catch (error) {
            if (/^(COMMIT|ROLLBACK)$/i.test(query.trim()) || (error instanceof Error && /timeout/i.test(error.message)))
              poisoned = true;
            throw error;
          }
        };
      return Reflect.get(target, property);
    },
  });
}

function postgresDialect(config: ServerConfig, readOnly: boolean): PostgresDialect {
  const pool = new pg.Pool(postgresOptions(config, readOnly));
  // An idle socket error must not crash the process or log driver credentials. The next health
  // check/query establishes availability; pg removes failed idle clients from the pool.
  pool.on('error', () => {});
  return new PostgresDialect({
    pool: {
      options: pool.options,
      end: () => pool.end(),
      connect: async () => guardedPostgresClient(await pool.connect()),
    },
  });
}

function dialectFor(config: StorageConfig, readOnly: boolean): Dialect {
  if (config.backend === 'sqlite') return new NodeSqliteDialect(config, readOnly);
  if (config.backend === 'postgres') return postgresDialect(config, readOnly);
  return new MysqlDialect({ pool: mysqlPool(config, readOnly) });
}

/** Storage-internal. Application code depends on `Storage` in domain/ports.ts. */
export interface StorageConnection<Database> {
  readonly db: Kysely<Database>;
  readonly backend: StorageConfig['backend'];
  readonly destination: string;
  readonly readOnly: boolean;
  health(): Promise<void>;
  close(): Promise<void>;
}

/** Opens and probes without migrating or building repositories. No fallback path. */
export async function openConnection<Database = Record<string, never>>(
  config: StorageConfig,
  readOnly = false,
): Promise<StorageConnection<Database>> {
  let db: Kysely<Database> | undefined;
  try {
    db = new Kysely<Database>({ dialect: dialectFor(config, readOnly) });
    await sql`select 1 as healthy`.execute(db);
    const connection = db;
    let closing: Promise<void> | undefined;
    return {
      db: connection,
      backend: config.backend,
      destination: safeDestination(config),
      readOnly,
      async health() {
        try {
          if (closing) throw new Error('closed');
          await sql`select 1 as healthy`.execute(connection);
        } catch {
          throw new StorageConnectionError('health', config.backend);
        }
      },
      close() {
        closing ??= connection.destroy().catch(() => {
          throw new StorageConnectionError('close', config.backend);
        });
        return closing;
      },
    };
  } catch {
    try {
      await db?.destroy();
    } catch {
      /* Preserve a redacted open error even if cleanup also fails. */
    }
    throw new StorageConnectionError('open', config.backend);
  }
}

/** One network reader per worker. SQLite files open read-only; memory runs inline on the caller. */
export function openReadConnection<Database = Record<string, never>>(
  config: StorageConfig,
): Promise<StorageConnection<Database>> {
  return openConnection<Database>(config, true);
}
