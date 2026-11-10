import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryResolution, getEntryIn } from '../src/domain/entryAccess.ts';
import { createTimerPublication } from '../src/services/timerDelivery.ts';
import { createCatalogOperations } from '../src/services/catalogOperations.ts';
import { createEntryOperations } from '../src/services/entryOperations.ts';
import type { EntryDetails } from '../src/domain/model.ts';
import { initializeDatabase } from '../src/storage/migrations.ts';
import { createTransactionRunner } from '../src/storage/transactions.ts';
import { entryAccount, entryTimerFactory } from './storage/support/entry-timer.ts';

test('getEntryIn reads one entry and nothing else', async () => {
  const entry = { id: 7, workspaceId: 3 } as EntryDetails;
  const asked: unknown[][] = [];
  const entries = {
    get: async (...args: [number, number, boolean?]) => {
      asked.push(args);
      return entry;
    },
  };
  assert.equal(await getEntryIn({ entries }, 1, 3, 7), entry);
  await assert.rejects(getEntryIn({ entries }, 1, 4, 7), /Time entry not found/);
  assert.deepEqual(asked, [
    [1, 7, undefined],
    [1, 7, undefined],
  ]);
});

test('entryResolution reads the instance settings and nothing else', async () => {
  assert.equal(await entryResolution({ settings: { read: async () => ({ timeResolutionMinutes: 15 }) } }), 15);
});

test('entry and catalog writes run on a runner that offers only transactions', async t => {
  const config = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
  const connection = await initializeDatabase(config);
  t.after(() => connection.close());
  const storage = createTransactionRunner(connection, entryTimerFactory('sqlite'));
  const user = await storage.transaction(r => r.users.createAccount(entryAccount('narrow')));
  const publish = createTimerPublication(async () => {}).publish;
  // No readSnapshot, health or close: the writes open transactions and nothing else.
  const transactionsOnly = { transaction: storage.transaction };
  const project = await createCatalogOperations(transactionsOnly, user.id, publish).createProject(
    user.defaultWorkspaceId,
    { name: 'Narrow' },
  );
  const entries = createEntryOperations(transactionsOnly, user, publish);
  const running = await entries.create(user.defaultWorkspaceId, {
    allDay: false,
    times: { start: new Date('2026-10-14T09:00:00Z') },
    projectId: project.id,
  });
  const stopped = await entries.stop(user.defaultWorkspaceId, running.id, new Date('2026-10-14T10:00:00Z'));
  assert.equal(stopped.stop, '2026-10-14T10:00:00.000Z');
  assert.equal(stopped.projectId, project.id);
});
