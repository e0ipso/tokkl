import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Kysely } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { StorageConflict } from '../../src/storage/errors.ts';
import {
  createTransactionRunner,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  retryDelay,
} from '../../src/storage/transactions.ts';
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
      let publicationErrors = 0;
      const reportingRunner = createTransactionRunner(connection, repositoryFactory, {
        publicationFailed() {
          publicationErrors++;
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
        assert.equal(publicationErrors, 1);
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

test('sqlite: a conflicted attempt reruns after a bounded, jittered wait', async () => {
  const fixture = await disposableBackend('sqlite');
  const connection = await initializeDatabase(fixture.config);
  const waits: number[] = [];
  const shares = [0, 0.5, 0.999];
  const runner = createTransactionRunner(connection, repositoryFactory, {
    random: () => shares.shift()!,
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
  });
  try {
    let attempts = 0;
    await runner.transaction(
      async ctx => {
        await ctx.settings.put(`retry-${attempts}`, 'yes');
        if (++attempts < 4) throw new StorageConflict(attempts === 2 ? 'deadlock' : 'serialization');
      },
      { maxAttempts: 4 },
    );
    assert.equal(attempts, 4);
    assert.deepEqual(waits, [RETRY_BASE_DELAY_MS / 2, RETRY_BASE_DELAY_MS * 1.5, RETRY_BASE_DELAY_MS * 4 * 0.9995]);
    // A conflict that is not retryable, or one on the last attempt, fails without waiting.
    await assert.rejects(
      runner.transaction(async () => {
        throw new StorageConflict('unique');
      }),
    );
    await assert.rejects(
      runner.transaction(
        async () => {
          throw new StorageConflict('serialization');
        },
        { maxAttempts: 1 },
      ),
    );
    assert.equal(waits.length, 3);
  } finally {
    await connection.close();
    await fixture.cleanup();
  }
});

test('retry waits double from the base and never pass the cap', () => {
  for (let failed = 1; failed <= 10; failed++) {
    const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failed - 1));
    assert.equal(
      retryDelay(failed, () => 0),
      ceiling / 2,
    );
    assert.ok(retryDelay(failed, () => 0.9999) < ceiling);
    assert.ok(retryDelay(failed, () => 7) <= RETRY_MAX_DELAY_MS);
  }
});
