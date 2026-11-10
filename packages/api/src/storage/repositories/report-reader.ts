import type { StorageConfig } from '../config.ts';
import { openReadConnection } from '../connections.ts';
import type { Repositories } from '../../domain/ports.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { createTransactionRunner } from '../transactions.ts';
import { createAccountRepositories } from './accounts.ts';
import { createReportRepositories } from './reports.ts';
import { createTransferRepositories } from './transfers.ts';

export const reportRunsInline = (config: StorageConfig): boolean =>
  config.backend === 'sqlite' && config.filename === ':memory:';
type ReportReaderRepositories = Pick<Repositories, 'users' | 'workspaces' | 'sessions' | 'reports' | 'transfers'>;
export interface ReportReader {
  readSnapshot<T>(work: (repositories: ReportReaderRepositories) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
/** No migration import and no writable fallback, on purpose. */
export async function openReportReader(config: StorageConfig): Promise<ReportReader> {
  const connection = await openReadConnection<PhysicalDatabase>(config);
  const runner = createTransactionRunner(connection, db => ({
    ...createAccountRepositories(db, config.backend),
    ...createReportRepositories(db, config.backend),
    ...createTransferRepositories(db, config.backend),
  }));
  return { readSnapshot: runner.readSnapshot, close: () => connection.close() };
}
