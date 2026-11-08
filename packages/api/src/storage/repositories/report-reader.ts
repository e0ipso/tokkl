import type { StorageConfig } from '../config.ts';
import { openReadConnection } from '../connections.ts';
import type { ReadOnlyRepositories } from '../contracts.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { createTransactionRunner } from '../transactions.ts';
import { createAccountRepositories } from './accounts.ts';
import { createReportRepositories } from './reports.ts';
import { createTransferRepositories } from './transfers.ts';

export const reportRunsInline = (config: StorageConfig): boolean =>
  config.backend === 'sqlite' && config.filename === ':memory:';
/** The accounts, reports and exports a report worker's read-only snapshot hands out. */
export type ReportReaderRepositories = Pick<
  ReadOnlyRepositories,
  'users' | 'workspaces' | 'sessions' | 'reports' | 'transfers'
>;
export interface ReportReader {
  readSnapshot<T>(work: (repositories: ReportReaderRepositories) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
/** Reader construction deliberately has no initializer/migration import or writable fallback. */
export async function openReportReader(config: StorageConfig): Promise<ReportReader> {
  const connection = await openReadConnection<PhysicalDatabase>(config);
  const runner = createTransactionRunner(connection, db => ({
    ...createAccountRepositories(db, config.backend),
    ...createReportRepositories(db, config.backend),
    ...createTransferRepositories(db, config.backend),
  }));
  return { readSnapshot: runner.readSnapshot, close: () => connection.close() };
}
