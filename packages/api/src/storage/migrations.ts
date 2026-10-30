import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { sql, type Kysely } from 'kysely';
import type { Backend, StorageConfig } from './config.ts';
import { openConnection, openReadConnection, type StorageConnection } from './connections.ts';
import type { PhysicalDatabase } from './physical.ts';
import { baselineDDL, createTableDDL, indexDDL, ledgerColumns, quote, serverDDL, totalsIndexes } from './schema.ts';

export class StorageMigrationError extends Error {
  constructor(reason: 'unsupported-engine' | 'unsupported-schema' | 'inconsistent-schema' | 'migration-failed' | 'reader') {
    super(`Storage initialization refused (${reason})`);
    this.name = 'StorageMigrationError';
  }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface Migration { readonly version: number; readonly name: string; readonly statements: readonly string[] }
/** Storage-internal immutable history. The second version adds covering history totals indexes. */
export function migrations(backend: Backend): readonly Migration[] {
  return [
    { version: 1, name: 'baseline', statements: baselineDDL(backend) },
    { version: 2, name: 'indexed_history_totals', statements: totalsIndexes.map(index => indexDDL(backend, index)) },
    { version: 3, name: 'fractional_task_estimates', statements: backend === 'sqlite' ? [] : [backend === 'postgres'
      ? 'ALTER TABLE tasks ALTER COLUMN estimated_seconds TYPE DOUBLE PRECISION'
      : 'ALTER TABLE tasks MODIFY COLUMN estimated_seconds DOUBLE NULL'] },
  ];
}
const run = (db: Kysely<PhysicalDatabase>, statement: string) => sql.raw(statement).execute(db);

export function assertSupportedEngine(backend: Backend, version: string): void {
  const supported = backend === 'postgres' ? /^PostgreSQL 18\.\d+\b/.test(version)
    : backend === 'mysql' ? /^8\.4\.\d+(?:\b|-)/.test(version) && !/mariadb/i.test(version)
    : backend === 'mariadb' ? /^11\.8\.\d+.*MariaDB/.test(version)
    : /^3\.(?:[5-9]\d|[1-9]\d{2,})\.\d+$/.test(version);
  if (!supported) throw new StorageMigrationError('unsupported-engine');
}
export async function validateEngine(connection: StorageConnection<PhysicalDatabase>): Promise<string> {
  const result = await sql.raw<{ version: string }>(connection.backend === 'sqlite' ? 'select sqlite_version() as version' : 'select version() as version').execute(connection.db);
  const version = result.rows[0]!.version;
  assertSupportedEngine(connection.backend, version);
  return version;
}
async function tableNames(db: Kysely<PhysicalDatabase>, backend: Backend): Promise<string[]> {
  const query = backend === 'sqlite' ? "select name from sqlite_schema where type in ('table','view','trigger') and name not like 'sqlite_%' order by name"
    : backend === 'postgres' ? "select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=current_schema() and c.relkind in ('r','p','v','m','f','S') order by c.relname"
    : "select table_name as name from information_schema.tables where table_schema=database() order by table_name";
  return (await sql.raw<{ name: string }>(query).execute(db)).rows.map(row => row.name);
}
/** A schema fingerprint excludes row data, sequences and MySQL's changing AUTO_INCREMENT counter. */
export async function schemaFingerprint(db: Kysely<PhysicalDatabase>, backend: Backend): Promise<string> {
  if (backend === 'sqlite') return digest((await sql.raw("select type, name, tbl_name, sql from sqlite_schema where name not like 'sqlite_%' order by type, name").execute(db)).rows);
  if (backend === 'postgres') {
    const queries = [
      "select table_name,column_name,ordinal_position,is_nullable,data_type,column_default,collation_name,is_identity,is_generated,generation_expression from information_schema.columns where table_schema=current_schema() order by table_name,ordinal_position",
      "select t.relname,c.conname,pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname=current_schema() order by t.relname,c.conname",
      "select tablename,indexname,indexdef from pg_indexes where schemaname=current_schema() order by tablename,indexname",
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
  definitions.push(JSON.stringify((await sql`select trigger_name, event_manipulation, event_object_table, action_statement, action_timing from information_schema.triggers where trigger_schema=database() order by trigger_name`.execute(db)).rows));
  return digest(definitions);
}
async function history(db: Kysely<PhysicalDatabase>, backend: Backend, available: readonly Migration[]): Promise<number> {
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
    if (!expected || Number(row.version) !== index + 1 || row.name !== expected.name || row.checksum !== digest(expected)
      || row.state !== 'complete' || !row.schema_hash) throw new StorageMigrationError('inconsistent-schema');
  }
  if (rows.at(-1)!.schema_hash !== await schemaFingerprint(db, backend)) throw new StorageMigrationError('inconsistent-schema');
  return rows.length;
}
/** Copy for inspection: even a read-only WAL open can create/change SHM beside the original.
 * WAL files are copied as well, so an uncheckpointed legacy schema cannot masquerade as empty.
 * An inconsistent snapshot fails closed. No original database/PRAGMA/sidecar is written.
 */
async function sqlitePreflight(config: StorageConfig): Promise<void> {
  if (config.backend !== 'sqlite' || config.filename === ':memory:' || !existsSync(config.filename)) return;
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-preflight-'));
  let reader: StorageConnection<PhysicalDatabase> | undefined;
  try {
    const filename = join(dir, 'inspect.sqlite');
    copyFileSync(config.filename, filename);
    for (const suffix of ['-wal', '-shm', '-journal']) if (existsSync(config.filename + suffix)) copyFileSync(config.filename + suffix, filename + suffix);
    if (statSync(filename).size === 0 && !existsSync(filename + '-wal')) return;
    reader = await openReadConnection<PhysicalDatabase>({ ...config, filename });
    const userVersion = (await sql.raw<{ user_version: number }>('PRAGMA user_version').execute(reader.db)).rows[0]!.user_version;
    const applicationId = (await sql.raw<{ application_id: number }>('PRAGMA application_id').execute(reader.db)).rows[0]!.application_id;
    if (userVersion !== 0 || applicationId !== 0) throw new StorageMigrationError('unsupported-schema');
    await history(reader.db, 'sqlite', migrations('sqlite'));
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('unsupported-schema');
  } finally { await reader?.close(); rmSync(dir, { recursive: true, force: true }); }
}

/** Explicit application startup initializer. Report connections never call it. */
export async function initializeDatabase(config: StorageConfig): Promise<StorageConnection<PhysicalDatabase>> {
  await sqlitePreflight(config);
  const connection = await openConnection<PhysicalDatabase>(config);
  try { await migrate(connection); return connection; }
  catch (error) { await connection.close(); throw error; }
}
export async function verifyCurrent(connection: StorageConnection<PhysicalDatabase>): Promise<void> {
  try {
    await validateEngine(connection);
    if (await history(connection.db, connection.backend, migrations(connection.backend)) !== migrations(connection.backend).length) throw new StorageMigrationError('inconsistent-schema');
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('inconsistent-schema');
  }
}
/** Not exported through application contracts. Explicit history override supports upgrade/fault fixtures. */
export async function migrate(connection: StorageConnection<PhysicalDatabase>, available = migrations(connection.backend), afterStatement?: () => Promise<void>): Promise<void> {
  if (connection.readOnly) throw new StorageMigrationError('reader');
  const backend = connection.backend;
  try {
    await validateEngine(connection);
    if (available.some((migration, index) => migration.version !== index + 1)) throw new StorageMigrationError('inconsistent-schema');
    await connection.db.connection().execute(async db => {
      let locked = false;
      let busyTimeout: number | undefined;
      const lockName = !serverDDL(backend) ? '' : `tokkl-migrate-${digest((await sql`select database() as name`.execute(db)).rows).slice(0, 32)}`;
      try {
        if (backend === 'sqlite') {
          // Zero busy wait avoids blocking this process while another async owner needs to commit.
          busyTimeout = Number((await sql.raw<{ timeout: number }>('PRAGMA busy_timeout').execute(db)).rows[0]!.timeout);
          await run(db, 'PRAGMA busy_timeout=0');
          const deadline = Date.now() + 30000;
          for (;;) {
            try { await run(db, 'BEGIN IMMEDIATE'); locked = true; break; }
            catch (error) {
              if ((error as { errcode?: number }).errcode !== 5 || Date.now() >= deadline) throw error;
              await setTimeout(20);
            }
          }
        } else if (backend === 'postgres') {
          await run(db, "SELECT pg_advisory_lock(783213, 1)"); locked = true;
          await run(db, 'BEGIN');
        } else {
          const lock = await sql<{ acquired: number }>`SELECT GET_LOCK(${lockName}, 30) as acquired`.execute(db);
          if (Number(lock.rows[0]?.acquired) !== 1) throw new StorageMigrationError('migration-failed');
          locked = true;
        }
        const version = await history(db, backend, available);
        if (!version) await run(db, createTableDDL(backend, 'storage_migrations', ledgerColumns));
        for (const migration of available.slice(version)) {
          // Autocommit engines persist this intent BEFORE the first implicit DDL commit. A crash or
          // failure leaves 'applying', and every future initializer refuses without replaying DDL.
          await db.insertInto('storage_migrations').values({ version: migration.version, name: migration.name, checksum: digest(migration), state: 'applying', schema_hash: null }).execute();
          for (const statement of migration.statements) { await run(db, statement); await afterStatement?.(); }
          const fingerprint = await schemaFingerprint(db, backend);
          await db.updateTable('storage_migrations').set({ state: 'complete', schema_hash: fingerprint }).where('version', '=', migration.version).execute();
        }
        if (!serverDDL(backend)) await run(db, 'COMMIT');
      } catch (error) {
        if (locked && !serverDDL(backend)) await run(db, 'ROLLBACK').catch(() => {});
        throw error;
      } finally {
        if (busyTimeout !== undefined) await run(db, `PRAGMA busy_timeout=${busyTimeout}`);
        if (locked && backend === 'postgres') await run(db, 'SELECT pg_advisory_unlock(783213, 1)');
        if (locked && serverDDL(backend)) await sql`SELECT RELEASE_LOCK(${lockName})`.execute(db);
      }
    });
  } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    throw new StorageMigrationError('migration-failed');
  }
}
