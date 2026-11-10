import type { Backend, StorageConfig } from './config.ts';
import { openConnection, type StorageConnection } from './connections.ts';
import { runMigrations, sqlitePreflight, type Migration } from './migrationRunner.ts';
import type { PhysicalDatabase } from './physical.ts';
import {
  accountTokenEmailDDL,
  baselineDDL,
  catalogRevisionDDL,
  idempotencyDDL,
  indexDDL,
  rateLimitDDL,
  runningEntriesDDL,
  timerSessionEntryDDL,
  totalsIndexes,
} from './schema.ts';

/** Immutable history. */
export function migrations(backend: Backend): readonly Migration[] {
  return [
    { version: 1, name: 'baseline', statements: baselineDDL(backend) },
    { version: 2, name: 'indexed_history_totals', statements: totalsIndexes.map(index => indexDDL(backend, index)) },
    {
      version: 3,
      name: 'fractional_task_estimates',
      statements:
        backend === 'sqlite'
          ? []
          : [
              backend === 'postgres'
                ? 'ALTER TABLE tasks ALTER COLUMN estimated_seconds TYPE DOUBLE PRECISION'
                : 'ALTER TABLE tasks MODIFY COLUMN estimated_seconds DOUBLE NULL',
            ],
    },
    { version: 4, name: 'running_entries_by_user', statements: runningEntriesDDL(backend) },
    { version: 5, name: 'rate_limits', statements: rateLimitDDL(backend) },
    { version: 6, name: 'timer_session_entry', statements: timerSessionEntryDDL(backend) },
    { version: 7, name: 'idempotency_keys', statements: idempotencyDDL(backend) },
    { version: 8, name: 'catalog_revision', statements: catalogRevisionDDL(backend) },
    { version: 9, name: 'account_token_email', statements: accountTokenEmailDDL(backend) },
  ];
}

/** Report connections never call it. */
export async function initializeDatabase(config: StorageConfig): Promise<StorageConnection<PhysicalDatabase>> {
  await sqlitePreflight(config, migrations('sqlite'));
  const connection = await openConnection<PhysicalDatabase>(config);
  try {
    await runMigrations(connection, migrations(connection.backend));
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
