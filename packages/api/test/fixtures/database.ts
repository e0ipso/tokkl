import { DatabaseSync } from 'node:sqlite';
import { after } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import type { Storage, TransactionContext } from '../../src/storage/contracts.ts';
import type { ApplicationServices } from '../../src/services/application.ts';
export type FixtureDatabase = DatabaseSync;
const fixtures = new WeakMap<DatabaseSync, { storage: Storage; filename: string; inline: boolean; services?: ApplicationServices }>();
const operations = new AsyncLocalStorage<{ db: DatabaseSync; ctx: TransactionContext }>();
/** Captures the actual SQLite driver only for controlled physical fixtures. Application calls use storage. */
export async function openDatabase(filename = ':memory:'): Promise<DatabaseSync> {
  const prepare = DatabaseSync.prototype.prepare;
  let physical: DatabaseSync | undefined;
  DatabaseSync.prototype.prepare = function (sql: string) {
    if ((this.location() ?? ':memory:') === filename) physical = this;
    return prepare.call(this, sql);
  };
  let storage: Storage;
  try { storage = createStorage(await initializeDatabase({ backend: 'sqlite', filename, busyTimeoutMs: 5000 })); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  if (!physical) { await storage.close(); throw new Error('SQLite fixture driver was not observed'); }
  const db = physical;
  fixtures.set(db, { storage, filename, inline: filename === ':memory:' });
  after(async () => { await fixtures.get(db)?.services?.close(); await storage.close(); });
  return db;
}
export function storageFor(db: DatabaseSync): Storage { const fixture = fixtures.get(db); if (!fixture) throw Error('Unknown fixture'); return fixture.storage; }
export function filenameFor(db: DatabaseSync): string { return fixtures.get(db)!.filename; }
export function setServices(db: DatabaseSync, services: ApplicationServices): void { fixtures.get(db)!.services = services; }
export function servicesFor(db: DatabaseSync): ApplicationServices { return fixtures.get(db)!.services!; }
export async function transaction<T>(db: DatabaseSync, work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
  const current = operations.getStore();
  if (current?.db === db) return work(current.ctx);
  return storageFor(db).transaction(ctx => operations.run({ db, ctx }, () => work(ctx)));
}
export function currentContext(db: DatabaseSync): TransactionContext | undefined { const current = operations.getStore(); return current?.db === db ? current.ctx : undefined; }

export function reportFilenameFor(db:DatabaseSync):string {const f=fixtures.get(db)!;return f.inline?':memory:':f.filename;}
