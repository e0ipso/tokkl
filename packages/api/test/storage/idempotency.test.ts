import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNewEntry } from '../../src/commands/timeEntries.ts';
import { IDEMPOTENCY_RETENTION_MS } from '../../src/domain/idempotency.ts';
import { idempotencyClaim } from '../../src/lib/idempotency.ts';
import { createEntryOperations } from '../../src/services/entryOperations.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { StorageConflict } from '../../src/storage/errors.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryAccount, entryTimerFactory } from './support/entry-timer.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: idempotency keys create once across connections and expire`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 };
    const connection = await initializeDatabase(config),
      other = await openConnection<PhysicalDatabase>(config);
    const factory = entryTimerFactory(backend);
    const runners = [createTransactionRunner(connection, factory), createTransactionRunner(other, factory)];
    const runner = runners[0]!;
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('keys')));
      const wid = user.defaultWorkspaceId;
      const publish = async () => {};
      const count = async () => (await runner.readSnapshot(ctx => ctx.entries.list(user.id))).length;
      const entry = parseNewEntry({ description: 'Race', start: '2026-10-14T09:00:00Z', duration: 600 });
      const claim = idempotencyClaim('race', { method: 'POST', url: '/entries', body: '{"description":"Race"}' });

      await t.test('two creates with one key on two connections at once make one entry', async () => {
        const operations = runners.map(r => createEntryOperations(r, user, publish));
        const created = await Promise.all(operations.map(o => o.create(wid, entry, claim)));
        assert.equal(created[0]!.id, created[1]!.id);
        assert.equal(await count(), 1);
        const again = await operations[1]!.create(wid, entry, claim);
        assert.equal(again.id, created[0]!.id);
        assert.equal(await count(), 1);
      });

      await t.test('a key recorded by another transaction fails as a retryable conflict', async () => {
        const record = {
          keyHash: 'twice',
          userId: user.id,
          fingerprint: 'request',
          resultId: 1,
          createdAt: new Date().toISOString(),
        };
        await runner.transaction(ctx => ctx.idempotencyKeys.insert(record));
        await assert.rejects(
          runners[1]!.transaction(ctx => ctx.idempotencyKeys.insert(record), { maxAttempts: 1 }),
          (error: unknown) => error instanceof StorageConflict && error.kind === 'serialization',
        );
      });

      await t.test('cleanup deletes records past the retention and keeps the rest', async () => {
        const now = Date.now();
        const at = (age: number) => new Date(now - age).toISOString();
        const record = (keyHash: string, createdAt: string) => ({
          keyHash,
          userId: user.id,
          fingerprint: 'request',
          resultId: 1,
          createdAt,
        });
        await runner.transaction(async ctx => {
          await ctx.idempotencyKeys.insert(record('old', at(IDEMPOTENCY_RETENTION_MS + 1000)));
          await ctx.idempotencyKeys.insert(record('new', at(1000)));
        });
        await runner.transaction(ctx => ctx.idempotencyKeys.deleteExpired(at(IDEMPOTENCY_RETENTION_MS)));
        await runner.transaction(async ctx => {
          assert.equal(await ctx.idempotencyKeys.find('old'), undefined);
          assert.equal((await ctx.idempotencyKeys.find('new'))?.createdAt, at(1000));
        });
      });

      await t.test('deleting the user deletes their keys', async () => {
        await runner.transaction(ctx => ctx.users.delete(user.id));
        await runner.transaction(async ctx => assert.equal(await ctx.idempotencyKeys.find('new'), undefined));
      });
    } finally {
      await other.close();
      await connection.close();
      await fixture.cleanup();
    }
  });
}
