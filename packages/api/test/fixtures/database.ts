import { after } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import type { Storage, TransactionContext } from '../../src/storage/contracts.ts';
import type { StorageConfig, Backend } from '../../src/storage/config.ts';
import type { ApplicationServices } from '../../src/services/application.ts';
import { disposableBackend, type DisposableBackend } from '../storage/support/disposableBackend.ts';
import { registerPhysicalFixture } from './physical.ts';

/** Identity only. All application work uses the associated asynchronous storage. */
export interface FixtureDatabase { readonly backend: Backend }
interface Fixture { storage: Storage; config: StorageConfig; services?: ApplicationServices }
const fixtures = new WeakMap<FixtureDatabase, Fixture>();
const operations = new AsyncLocalStorage<{ db: FixtureDatabase; ctx: TransactionContext }>();
const owned: Array<{ handle: FixtureDatabase; cleanup?: () => Promise<void> }> = [];
let server: Promise<DisposableBackend> | undefined;

after(async () => {
  const failures: unknown[] = [];
  for (const { handle } of [...owned].reverse()) {
    try { await servicesFor(handle)?.close(); } catch (error) { failures.push(error); }
    try { await storageFor(handle).close(); } catch (error) { failures.push(error); }
  }
  for (const { cleanup } of [...owned].reverse()) {
    try { await cleanup?.(); } catch (error) { failures.push(error); }
  }
  try { await (await server)?.cleanup(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
});

function selectedBackend(): Backend {
  if (process.env.TOKKL_DATABASE_URL !== undefined || process.env.TOKKL_TEST_DATABASE_URL !== undefined) throw Error('Operator database targets are forbidden in test fixtures');
  const backend = process.env.TOKKL_TEST_BACKEND ?? 'sqlite';
  if (!['sqlite', 'postgres', 'mysql', 'mariadb'].includes(backend)) throw Error('Unknown test backend');
  return backend as Backend;
}
async function open(config: StorageConfig, cleanup?: () => Promise<void>): Promise<FixtureDatabase> {
  const connection = await initializeDatabase(config);
  const handle = Object.freeze({ backend: config.backend });
  fixtures.set(handle, { storage: createStorage(connection), config });
  registerPhysicalFixture(handle, connection.db);
  owned.push({ handle, cleanup });
  return handle;
}
export async function openDatabase(filename?: string): Promise<FixtureDatabase> {
  const backend = selectedBackend();
  if (filename !== undefined || backend === 'sqlite') return openSQLiteDatabase(filename);
  server ??= disposableBackend(backend);
  const namespace = await (await server).namespace!();
  try { return await open(namespace.config, namespace.cleanup); }
  catch (error) { await namespace.cleanup(); throw error; }
}
export function openSQLiteDatabase(filename = ':memory:'): Promise<FixtureDatabase> {
  selectedBackend();
  return open({ backend: 'sqlite', filename, busyTimeoutMs: 5000 });
}
export const reopenDatabase = (db: FixtureDatabase): Promise<FixtureDatabase> => open(storageConfigFor(db));
export function storageFor(db: FixtureDatabase): Storage { const f = fixtures.get(db); if (!f) throw Error('Unknown fixture'); return f.storage; }
export function storageConfigFor(db: FixtureDatabase): StorageConfig { const f = fixtures.get(db); if (!f) throw Error('Unknown fixture'); return f.config; }
export function filenameFor(db: FixtureDatabase): string { const c = storageConfigFor(db); if (c.backend !== 'sqlite') throw Error('SQLite filename required'); return c.filename; }
export function setServices(db: FixtureDatabase, services: ApplicationServices): void { fixtures.get(db)!.services = services; }
export function servicesFor(db: FixtureDatabase): ApplicationServices { return fixtures.get(db)!.services!; }
export async function transaction<T>(db: FixtureDatabase, work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
  const current = operations.getStore();
  if (current?.db === db) return work(current.ctx);
  return storageFor(db).transaction(ctx => operations.run({ db, ctx }, () => work(ctx)));
}
export function currentContext(db: FixtureDatabase): TransactionContext | undefined { const c = operations.getStore(); return c?.db === db ? c.ctx : undefined; }
