import { initializeDatabase } from '../../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../../src/storage/transactions.ts';
import { createReportRepositories } from '../../../src/storage/repositories/reports.ts';
import { StorageReportRunner } from '../../../src/services/storageReportRunner.ts';
import { disposableBackend } from './disposableBackend.ts';
import { entryAccount, entryTimerFactory } from './entry-timer.ts';
const fixture = await disposableBackend('sqlite');
const c = await initializeDatabase(fixture.config);
try {
  const operations = createTransactionRunner(c, db => ({ ...entryTimerFactory('sqlite')(db), ...createReportRepositories(db, 'sqlite') }));
  const user = await operations.transaction(r => r.users.createAccount(entryAccount('idle')));
  const runner = new StorageReportRunner(fixture.config, operations);
  const result = await runner.run(user.id, user.defaultWorkspaceId, { kind: 'app-report',
    filter: { startDate: '2026-10-01', endDate: '2026-10-31' }, grouping: 'project', sub: 'none' });
  console.log(`report ${result.type}`);
  // Deliberately leave the idle runner open to prove its thread cannot pin the parent process.
} finally { await c.close(); await fixture.cleanup(); }
