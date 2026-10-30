import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Kysely } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { disposableBackend } from './support/disposableBackend.ts';

function repositoryFactory(db: Kysely<PhysicalDatabase>) {
  return {
    settings: {
      async put(key: string, value: string) {
        await db.insertInto('instance_settings').values({ key, value, updated_at: '2026-01-01T00:00:00.000Z', updated_by: null }).execute();
      },
      async get(key: string) { return (await db.selectFrom('instance_settings').select('value').where('key', '=', key).executeTakeFirst())?.value; },
    },
  };
}
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: bound repositories, join, hooks, savepoint recovery and rollback`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 });
    const runner = createTransactionRunner(connection, repositoryFactory);
    const events: string[] = [];
    let publicationErrors = 0;
    const reportingRunner = createTransactionRunner(connection, repositoryFactory, { publicationFailed() { publicationErrors++; throw new Error('reporter failed'); } });
    try {
      await runner.transaction(async ctx => {
        await ctx.settings.put('outer', 'yes');
        ctx.beforeCommit('settle', async () => { events.push('original'); await ctx.settings.put('before', 'yes'); });
        ctx.afterCommit(async () => { events.push('after'); assert.equal(await runner.readSnapshot(r => r.settings.get('before')), 'yes'); });
        await ctx.transaction(async nested => { assert.equal(nested, ctx); assert.equal(await nested.settings.get('outer'), 'yes'); });
        await assert.rejects(ctx.savepoint(async sp => {
          sp.beforeCommit('settle', async () => { events.push('replacement'); });
          sp.afterCommit(async () => { events.push('discard'); });
          await sp.settings.put('rolled-back', 'no');
          await sp.settings.put('outer', 'duplicate');
        }));
        await ctx.settings.put('later', 'yes');
      });
      assert.deepEqual(events, ['original', 'after']);
      assert.equal(await runner.readSnapshot(r => r.settings.get('rolled-back')), undefined);
      await assert.rejects(runner.transaction(async ctx => {
        await ctx.settings.put('rollback', 'no');
        ctx.afterCommit(async () => { events.push('bad'); });
        ctx.beforeCommit('fail', async () => { throw new Error('settlement failed'); });
      }), /settlement failed/);
      assert.equal(await runner.readSnapshot(r => r.settings.get('rollback')), undefined);
      assert.deepEqual(events, ['original', 'after']);
      await reportingRunner.transaction(async ctx => {
        ctx.beforeCommit('one', async () => { await Promise.resolve(); events.push('one'); ctx.beforeCommit('two', async () => { events.push('two'); }); });
        ctx.afterCommit(async () => { events.push('published'); throw new Error('publication failed'); });
        ctx.afterCommit(async () => { events.push('next'); });
      });
      assert.deepEqual(events.slice(2), ['one', 'two', 'published', 'next']);
      assert.equal(publicationErrors, 1);
      await runner.transaction(async ctx => {
        ctx.beforeCommit('replace', async () => { events.push('obsolete'); });
        ctx.beforeCommit('last', async () => { events.push('last'); });
        ctx.beforeCommit('replace', async () => { events.push('replacement accepted'); });
      });
      assert.deepEqual(events.slice(-2), ['replacement accepted', 'last']);
      const expired = await runner.transaction(async ctx => ctx);
      await assert.rejects(expired.settings.get('outer'), /context is closed/);
      assert.throws(() => expired.afterCommit(async () => {}), /context is closed/);
      const expiredRead = await runner.readSnapshot(async r => r);
      await assert.rejects(expiredRead.settings.get('outer'), /context is closed/);
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
