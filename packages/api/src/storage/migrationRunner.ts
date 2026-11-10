/** Applies the history under a lock, recording each step; refuses a ledger or schema that does not match. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { sql, type Kysely } from 'kysely';
import type { Backend, StorageConfig } from './config.ts';
import { openReadConnection, type StorageConnection } from './connections.ts';
import type { PhysicalDatabase } from './physical.ts';
import { createTableDDL, ledgerColumns, quote, serverDDL } from './schema.ts';

class StorageMigrationError extends Error {
  constructor(
    reason: 'unsupported-engine' | 'unsupported-schema' | 'inconsistent-schema' | 'migration-failed' | 'reader',
  ) {
    super(`Storage initialization refused (${reason})`);
    this.name = 'StorageMigrationError';
  }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}
const run = (db: Kysely<PhysicalDatabase>, statement: string) => sql.raw(statement).execute(db);

export function assertSupportedEngine(backend: Backend, version: string): void {
  const supported =
    backend === 'postgres'
      ? /^PostgreSQL 18\.\d+\b/.test(version)
      : backend === 'mysql'
        ? /^8\.4\.\d+(?:\b|-)/.test(version) && !/mariadb/i.test(version)
        : backend === 'mariadb'
          ? /^11\.8\.\d+.*MariaDB/.test(version)
          : /^3\.(?:[5-9]\d|[1-9]\d{2,})\.\d+$/.test(version);
  if (!supported) throw new StorageMigrationError('unsupported-engine');
}
export async function validateEngine(connection: StorageConnection<PhysicalDatabase>): Promise<string> {
  const result = await sql
    .raw<{ version: string }>(
      connection.backend === 'sqlite' ? 'select sqlite_version() as version' : 'select version() as version',
    )
    .execute(connection.db);
  const version = result.rows[0]!.version;
  assertSupportedEngine(connection.backend, version);
  return version;
}
async function tableNames(db: Kysely<PhysicalDatabase>, backend: Backend): Promise<string[]> {
  const query =
    backend === 'sqlite'
      ? "select name from sqlite_schema where type in ('table','view','trigger') and name not like 'sqlite_%' order by name"
      : backend === 'postgres'
        ? "select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=current_schema() and c.relkind in ('r','p','v','m','f','S') order by c.relname"
        : 'select table_name as name from information_schema.tables where table_schema=database() order by table_name';
  return (await sql.raw<{ name: string }>(query).execute(db)).rows.map(row => row.name);
}
/** Excludes row data, sequences and MySQL's changing AUTO_INCREMENT counter. */
export async function schemaFingerprint(db: Kysely<PhysicalDatabase>, backend: Backend): Promise<string> {
  if (backend === 'sqlite')
    return digest(
      (
        await sql
          .raw("select type, name, tbl_name, sql from sqlite_schema where name not like 'sqlite_%' order by type, name")
          .execute(db)
      ).rows,
    );
  if (backend === 'postgres') {
    const queries = [
      'select table_name,column_name,ordinal_position,is_nullable,data_type,column_default,collation_name,is_identity,is_generated,generation_expression from information_schema.columns where table_schema=current_schema() order by table_name,ordinal_position',
      'select t.relname,c.conname,pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=current_schema() order by t.relname,c.conname',
      'select tablename,indexname,indexdef from pg_indexes where schemaname=current_schema() order by tablename,indexname',
    ];
    const results = [];
    for (const query of queries) results.push((await sql.raw(query).execute(db)).rows);
    return digest(results);
  }
  const definitions = [];
  for (const table of await tableNames(db, backend)) {
    const result = await run(db, `SHOW CREATE TABLE ${quote(backend, table)}`);
    definitions.push(String(Object.values(result.rows[0] as object)[1]).replace(/ AUTO_INCREMENT=\d+/g, ''));
  }
  definitions.push(
    JSON.stringify(
      (
        await sql`select trigger_name, event_manipulation, event_object_table, action_statement, action_timing from information_schema.triggers where trigger_schema=database() order by trigger_name`.execute(
          db,
        )
      ).rows,
    ),
  );
  return digest(definitions);
}
async function history(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  available: readonly Migration[],
): Promise<number> {
  const names = await tableNames(db, backend);
  if (!names.includes('storage_migrations')) {
    if (names.length) throw new StorageMigrationError('unsupported-schema');
    return 0;
  }
  const rows = await db.selectFrom('storage_migrations').selectAll().orderBy('version').execute();
  if (!rows.length) throw new StorageMigrationError('inconsistent-schema');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const expected = available[index];
    if (
      !expected ||
      Number(row.version) !== index + 1 ||
      row.name !== expected.name ||
      row.checksum !== digest(expected) ||
      row.state !== 'complete' ||
      !row.schema_hash
    )
      throw new StorageMigrationError('inconsistent-schema');
  }
  if (rows.at(-1)!.schema_hash !== (await schemaFingerprint(db, backend)))
    throw new StorageMigrationError('inconsistent-schema');
  return rows.length;
}
/** Inspects a copy with its WAL files: even a read-only WAL open changes SHM. An inconsistent copy fails closed. */
export async function sqlitePreflight(config: StorageConfig, available: readonly Migration[]): Promise<void> {
  if (config.backend !== 'sqlite' || config.filename === ':memory:' || !existsSync(config.filename)) return;
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-preflight-'));
  let reader: StorageConnection<PhysicalDatabase> | undefined;
  try {
    const filename = join(dir, 'inspect.sqlite');
    copyFileSync(config.filename, filename);
    for (const suffix of ['-wal', '-shm', '-journal'])
      if (existsSync(config.filename + suffix)) copyFileSync(config.filename + suffix, filename + suffix);
    if (statSync(filename).size === 0 && !existsSync(filename + '-wal')) return;
    reader = await openReadConnection<PhysicalDatabase>({ ...config, filename });
    const userVersion = (await sql.raw<{ user_version: number }>('PRAGMA user_version').execute(reader.db)).rows[0]!
      .user_version;
    const applicationId = (await sql.raw<{ application_id: number }>('PRAGMA application_id').execute(reader.db))
      .rows[0]!.application_id;
    if (userVersion !== 0 || applicationId !== 0) throw new StorageMigrationError('unsupported-schema');
    await history(reader.db, 'sqlite', available);
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('unsupported-schema');
  } finally {
    await reader?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
/** How long a migrator waits for another one to finish before it gives up. */
const MIGRATION_LOCK_WAIT_MS = 30_000;
const SQLITE_LOCK_POLL_MS = 20;
const SQLITE_BUSY = 5;
const MIGRATION_ADVISORY_LOCK = '783213, 1';

/** A failure part way still restores SQLite's busy timeout, and the lock once `locked`. */
interface MigrationLock {
  /** Per database; empty for the other engines. */
  readonly name: string;
  locked: boolean;
  busyTimeout?: number;
}

async function migrationLockName(db: Kysely<PhysicalDatabase>, backend: Backend): Promise<string> {
  if (!serverDDL(backend)) return '';
  return `tokkl-migrate-${digest((await sql`select database() as name`.execute(db)).rows).slice(0, 32)}`;
}

/** MySQL and MariaDB commit each DDL statement, so only the named lock serializes them there. */
async function lockMigrations(db: Kysely<PhysicalDatabase>, backend: Backend, lock: MigrationLock): Promise<void> {
  if (backend === 'sqlite') {
    // Zero busy wait avoids blocking this process while another async owner needs to commit.
    lock.busyTimeout = Number((await sql.raw<{ timeout: number }>('PRAGMA busy_timeout').execute(db)).rows[0]!.timeout);
    await run(db, 'PRAGMA busy_timeout=0');
    const deadline = Date.now() + MIGRATION_LOCK_WAIT_MS;
    for (;;) {
      try {
        await run(db, 'BEGIN IMMEDIATE');
        lock.locked = true;
        return;
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== SQLITE_BUSY || Date.now() >= deadline) throw error;
        await setTimeout(SQLITE_LOCK_POLL_MS);
      }
    }
  }
  if (backend === 'postgres') {
    await run(db, `SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK})`);
    lock.locked = true;
    await run(db, 'BEGIN');
    return;
  }
  const seconds = sql.lit(MIGRATION_LOCK_WAIT_MS / 1000);
  const result = await sql<{ acquired: number }>`SELECT GET_LOCK(${lock.name}, ${seconds}) as acquired`.execute(db);
  if (Number(result.rows[0]?.acquired) !== 1) throw new StorageMigrationError('migration-failed');
  lock.locked = true;
}

async function unlockMigrations(db: Kysely<PhysicalDatabase>, backend: Backend, lock: MigrationLock): Promise<void> {
  if (lock.busyTimeout !== undefined) await run(db, `PRAGMA busy_timeout=${lock.busyTimeout}`);
  if (lock.locked && backend === 'postgres') await run(db, `SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK})`);
  if (lock.locked && serverDDL(backend)) await sql`SELECT RELEASE_LOCK(${lock.name})`.execute(db);
}

async function applyPending(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  available: readonly Migration[],
): Promise<void> {
  const version = await history(db, backend, available);
  if (!version) await run(db, createTableDDL(backend, 'storage_migrations', ledgerColumns));
  for (const migration of available.slice(version)) {
    // Autocommit engines persist this intent BEFORE the first implicit DDL commit. A crash or
    // failure leaves 'applying', and every future initializer refuses without replaying DDL.
    await db
      .insertInto('storage_migrations')
      .values({
        version: migration.version,
        name: migration.name,
        checksum: digest(migration),
        state: 'applying',
        schema_hash: null,
      })
      .execute();
    for (const statement of migration.statements) await run(db, statement);
    const fingerprint = await schemaFingerprint(db, backend);
    await db
      .updateTable('storage_migrations')
      .set({ state: 'complete', schema_hash: fingerprint })
      .where('version', '=', migration.version)
      .execute();
  }
}

/** Migrations number from 1. Refuses a reader, an unknown engine, and a mismatched ledger or schema. */
export async function runMigrations(
  connection: StorageConnection<PhysicalDatabase>,
  available: readonly Migration[],
): Promise<void> {
  if (connection.readOnly) throw new StorageMigrationError('reader');
  const backend = connection.backend;
  try {
    await validateEngine(connection);
    if (available.some((migration, index) => migration.version !== index + 1))
      throw new StorageMigrationError('inconsistent-schema');
    await connection.db.connection().execute(async db => {
      const lock: MigrationLock = { name: await migrationLockName(db, backend), locked: false };
      try {
        await lockMigrations(db, backend, lock);
        await applyPending(db, backend, available);
        if (!serverDDL(backend)) await run(db, 'COMMIT');
      } catch (error) {
        if (lock.locked && !serverDDL(backend)) await run(db, 'ROLLBACK').catch(() => {});
        throw error;
      } finally {
        await unlockMigrations(db, backend, lock);
      }
    });
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('migration-failed');
  }
}
