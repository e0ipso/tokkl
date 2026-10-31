import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { openConnection, type StorageConnection } from '../../src/storage/connections.ts';
import { disposableBackend } from './support/disposableBackend.ts';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const backend of ['mysql', 'mariadb'] as const) {
  test(`${backend}: overlapping requests wait for bounded pool checkouts`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    let connection: StorageConnection<Record<string, never>> | undefined;
    try {
      if (fixture.config.backend === 'sqlite') throw new Error('Expected a server fixture');
      const opened = connection = await openConnection({ ...fixture.config, poolMax: 1, connectTimeoutMs: 5000 });
      async function withHeldCheckout(work: () => Promise<void>) {
        const entered = gate(), release = gate();
        const held = opened.db.connection().execute(async () => { entered.resolve(); await release.promise; });
        try { await entered.promise; await work(); }
        finally { release.resolve(); await held; }
      }
      await t.test('ordinary bursts wait and succeed after release', async () => {
        let requests: Promise<PromiseSettledResult<void>[]> | undefined;
        await withHeldCheckout(async () => {
          requests = Promise.allSettled(Array.from({ length: 12 }, () => opened.health()));
          await setImmediate();
        });
        const results = await requests!;
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 12,
          'ordinary concurrent requests must wait for the existing connection');
      });
      await t.test('an expired waiter never runs and a late checkout returns to the pool', async () => {
        let ran = false;
        await withHeldCheckout(async () => {
          await assert.rejects(opened.db.connection().execute(async () => { ran = true; }),
            /Storage connection acquisition timed out/);
        });
        await opened.health();
        assert.equal(ran, false);
      });
      await t.test('excess demand is refused while admitted requests still drain', async () => {
        let refused = 0;
        let requests: Promise<PromiseSettledResult<void>[]> | undefined;
        await withHeldCheckout(async () => {
          requests = Promise.allSettled(Array.from({ length: 200 }, () => opened.health().catch(error => {
            refused++;
            throw error;
          })));
          await setImmediate();
          assert.ok(refused > 0, 'the waiting queue must have a finite capacity');
        });
        const results = await requests!;
        assert.ok(results.some(result => result.status === 'fulfilled'));
        assert.ok(results.some(result => result.status === 'rejected'));
        await opened.health();
      });
    } finally {
      await connection?.close();
      await fixture.cleanup();
    }
  });
}
