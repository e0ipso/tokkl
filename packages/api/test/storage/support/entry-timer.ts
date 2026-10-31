import type { Kysely } from 'kysely';
import type { Backend } from '../../../src/storage/config.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';
import { createAccountRepositories } from '../../../src/storage/repositories/accounts.ts';
import { createCatalogRepositories } from '../../../src/storage/repositories/catalogs.ts';
import { createEntryRepositories } from '../../../src/storage/repositories/entries.ts';
import { createTimerRepositories } from '../../../src/storage/repositories/timers.ts';
export const entryTimerFactory = (backend: Backend) => (db: Kysely<PhysicalDatabase>) => ({
  ...createAccountRepositories(db, backend), ...createCatalogRepositories(db, backend),
  ...createEntryRepositories(db, backend), ...createTimerRepositories(db, backend),
});
export const entryAccount = (name: string, role: 'admin' | 'user' = 'user') => ({ email: `${name}@example.test`, fullName: name,
  passwordHash: 'hash', apiToken: `token-${name}`, timezone: 'UTC', role, preferences: {} });
export const entryAt = (time: string) => new Date(`2026-10-14T${time}Z`);
