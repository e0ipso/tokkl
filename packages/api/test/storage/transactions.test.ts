import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Kysely } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { StorageConflict } from '../../src/domain/ports.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { disposableBackend } from './support/disposableBackend.ts';

function repositoryFactory(db: Kysely<PhysicalDatabase>) {
  return {
    settings: {
      async put(key: string, value: string) {
        await db
          .insertInto('instance_settings')
          .values({ key, value, updated_at: '2026-01-01T00:00:00.000Z', updated_by: null })
          .execute();
      },
      async get(key: string) {
        return (await db.selectFrom('instance_settings').select('value').where('key', '=', key).executeTakeFirst())
          ?.value;
      },
    },
  };
}
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(
    `${backend}: bound repositories, join, hooks, savepoint recovery and rollback`,
    { timeout: 180000 },
    async () => {
      const fixture = await disposableBackend(backend);
      const connection = await initializeDatabase(
        fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 },
      );
      const runner = createTransactionRunner(connection, repositoryFactory);
      const events: string[] = [];
      const publicationErrors: unknown[] = [];
      const reportingRunner = createTransactionRunner(connection, repositoryFactory, {
        afterCommitFailed(error) {
          publicationErrors.push(error);
          throw new Error('reporter failed');
        },
      });
      try {
        await runner.transaction(async ctx => {
          await ctx.settings.put('outer', 'yes');
          ctx.beforeCommit('settle', async () => {
            events.push('original');
            await ctx.settings.put('before', 'yes');
          });
          ctx.afterCommit(async () => {
            events.push('after');
            assert.equal(await runner.readSnapshot(r => r.settings.get('before')), 'yes');
          });
          // Only the runner opens transactions; the context it hands out cannot start another.
          assert.equal('transaction' in ctx, false);
          await assert.rejects(
            ctx.savepoint(async sp => {
              sp.beforeCommit('settle', async () => {
                events.push('replacement');
              });
              sp.afterCommit(async () => {
                events.push('discard');
              });
              await sp.settings.put('rolled-back', 'no');
              await sp.settings.put('outer', 'duplicate');
            }),
          );
          await ctx.settings.put('later', 'yes');
        });
        assert.deepEqual(events, ['original', 'after']);
        assert.equal(await runner.readSnapshot(r => r.settings.get('rolled-back')), undefined);
        await assert.rejects(
          runner.transaction(async ctx => {
            await ctx.settings.put('rollback', 'no');
            ctx.afterCommit(async () => {
              events.push('bad');
            });
            ctx.beforeCommit('fail', async () => {
              throw new Error('settlement failed');
            });
          }),
          /settlement failed/,
        );
        assert.equal(await runner.readSnapshot(r => r.settings.get('rollback')), undefined);
        assert.deepEqual(events, ['original', 'after']);
        await reportingRunner.transaction(async ctx => {
          ctx.beforeCommit('one', async () => {
            await Promise.resolve();
            events.push('one');
            ctx.beforeCommit('two', async () => {
              events.push('two');
            });
          });
          ctx.afterCommit(async () => {
            events.push('published');
            throw new Error('publication failed');
          });
          ctx.afterCommit(async () => {
            events.push('next');
          });
        });
        assert.deepEqual(events.slice(2), ['one', 'two', 'published', 'next']);
        assert.equal(publicationErrors.length, 1);
        assert.match((publicationErrors[0] as Error).message, /publication failed/);
        await runner.transaction(async ctx => {
          ctx.beforeCommit('replace', async () => {
            events.push('obsolete');
          });
          ctx.beforeCommit('last', async () => {
            events.push('last');
          });
          ctx.beforeCommit('replace', async () => {
            events.push('replacement accepted');
          });
        });
        assert.deepEqual(events.slice(-2), ['replacement accepted', 'last']);
        // A read at commit runs after every hook, those registered after it included.
        let seen: string | undefined;
        await runner.transaction(async ctx => {
          ctx.readAtCommit(async () => {
            events.push('read');
            seen = await ctx.settings.get('late');
          });
          ctx.beforeCommit('late', async () => {
            events.push('late');
            await ctx.settings.put('late', 'yes');
          });
        });
        assert.equal(seen, 'yes');
        assert.deepEqual(events.slice(-2), ['late', 'read']);
        // It may only read: work it registers fails the transaction.
        await assert.rejects(
          runner.transaction(async ctx => {
            await ctx.settings.put('read-writes', 'no');
            ctx.readAtCommit(async () => ctx.beforeCommit('sneaky', async () => {}));
          }),
          /registered more work/,
        );
        assert.equal(await runner.readSnapshot(r => r.settings.get('read-writes')), undefined);
        const expired = await runner.transaction(async ctx => ctx);
        await assert.rejects(expired.settings.get('outer'), /context is closed/);
        assert.throws(() => expired.afterCommit(async () => {}), /context is closed/);
        const expiredRead = await runner.readSnapshot(async r => r);
        await assert.rejects(expiredRead.settings.get('outer'), /context is closed/);
      } finally {
        await connection.close();
        await fixture.cleanup();
      }
    },
  );
}

test('sqlite: a conflicted attempt reruns twice, after jittered waits that double', async t => {
  const fixture = await disposableBackend('sqlite');
  const connection = await initializeDatabase(fixture.config);
  const runner = createTransactionRunner(connection, repositoryFactory);
  const shares = [0, 0.5];
  t.mock.method(Math, 'random', () => shares.shift() ?? 0);
  const timeout = t.mock.method(globalThis, 'setTimeout');
  const waits = () => timeout.mock.calls.map(call => call.arguments[1]);
  try {
    let attempts = 0;
    await runner.transaction(async ctx => {
      await ctx.settings.put(`retry-${attempts}`, 'yes');
      if (++attempts < 3) throw new StorageConflict(attempts === 2 ? 'deadlock' : 'serialization');
    });
    assert.equal(attempts, 3);
    // Half of a 10 ms ceiling plus no share, then half of 20 ms plus half the rest.
    assert.deepEqual(waits(), [5, 15]);
    // A conflict that is not retryable fails at once; a third retryable one fails without a wait.
    await assert.rejects(
      runner.transaction(async () => {
        throw new StorageConflict('unique');
      }),
      (error: unknown) => error instanceof StorageConflict && error.kind === 'unique',
    );
    assert.equal(waits().length, 2);
    attempts = 0;
    await assert.rejects(
      runner.transaction(async () => {
        attempts++;
        throw new StorageConflict('serialization');
      }),
      (error: unknown) => error instanceof StorageConflict && error.kind === 'serialization',
    );
    assert.equal(attempts, 3);
    assert.equal(waits().length, 4);
  } finally {
    await connection.close();
    await fixture.cleanup();
  }
});
