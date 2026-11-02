import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'kysely';
import { sha256 } from '../../src/auth/crypto.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { createStorage } from '../../src/storage/index.ts';
import { migrate, migrations } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { insert, rows } from './support/schemaAssertions.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 10, minute)).toISOString();

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: the pending setup code is one hashed row, replaced and deleted inside transactions`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    try {
      // An installation that already has an account upgrades without a pending code.
      const connection = await openConnection<PhysicalDatabase>(fixture.config);
      const history = migrations(backend);
      await migrate(connection, history.slice(0, history.findIndex(migration => migration.name === 'setup_codes')));
      await insert(connection.db, backend, 'users', { email: 'existing@example.test', password_hash: 'hash', api_token: 'token', created_at: at(0), updated_at: at(0) });
      await migrate(connection);
      const storage = createStorage(connection);
      try {
        // @ts-expect-error The pending credential is only reachable inside transactions and snapshots.
        assert.equal(storage.setupCodes, undefined);
        const read = () => storage.readSnapshot(r => r.setupCodes.read());
        const stored = () => rows(connection.db, backend, 'setup_codes');
        assert.equal(await read(), undefined);

        const first = sha256('FIRST-CODE'), second = sha256('SECOND-CODE');
        await storage.transaction(async ctx => { await ctx.lockInstanceAdministration(); await ctx.setupCodes.replace(first, at(1)); });
        assert.equal(await read(), first);
        await storage.transaction(async ctx => { await ctx.lockInstanceAdministration(); await ctx.setupCodes.replace(second, at(2)); });
        assert.deepEqual((await stored()).map(row => [row.code_hash, row.created_at]), [[second, at(2)]]);

        // A failed transaction keeps the hash that was pending before it.
        await assert.rejects(storage.transaction(async ctx => {
          await ctx.setupCodes.replace(sha256('DISCARDED'), at(3));
          assert.equal(await ctx.setupCodes.read(), sha256('DISCARDED'));
          throw new Error('account write failed');
        }), /account write failed/);
        assert.equal(await read(), second);

        // Plaintext and malformed hashes are refused, and no second row can exist.
        for (const value of ['SECOND-CODE', second.toUpperCase(), second.slice(1), `${second}0`]) {
          await assert.rejects(storage.transaction(ctx => ctx.setupCodes.replace(value, at(4))), value);
        }
        await assert.rejects(insert(connection.db, backend, 'setup_codes', { purpose: 'first_admin', code_hash: first, created_at: at(5) }));
        assert.deepEqual((await stored()).map(row => row.code_hash), [second]);

        await storage.transaction(ctx => ctx.setupCodes.delete());
        assert.equal(await read(), undefined);
        await storage.transaction(ctx => ctx.setupCodes.delete());
        assert.equal((await stored()).length, 0);
        assert.equal(Number((await sql<{ n: number | string }>`select count(*) as n from users`.execute(connection.db)).rows[0]!.n), 1);
      } finally { await storage.close(); }
    } finally { await fixture.cleanup(); }
  });
}
