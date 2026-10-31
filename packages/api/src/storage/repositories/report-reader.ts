import type { StorageConfig } from '../config.ts';
import { openReadConnection } from '../connections.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { createTransactionRunner } from '../transactions.ts';
import { createAccountRepositories } from './accounts.ts';
import { createReportRepositories } from './reports.ts';

export const reportRunsInline = (config: StorageConfig): boolean => config.backend === 'sqlite' && config.filename === ':memory:';
/** Reader construction deliberately has no initializer/migration import or writable fallback. */
export async function openReportReader(config: StorageConfig) {
  const connection = await openReadConnection<PhysicalDatabase>(config);
  const runner = createTransactionRunner(connection, db => ({
    ...createAccountRepositories(db, config.backend), ...createReportRepositories(db, config.backend),
  }));
  return { readSnapshot: runner.readSnapshot, close: () => connection.close() };
}
