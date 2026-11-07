import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'kysely';
import { openConnection } from '../../src/storage/connections.ts';
import { initializeDatabase, migrate, migrations, verifyCurrent } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { assertSchema, assertDefaultsAndForeignKeys, insert, rows } from './support/schemaAssertions.ts';
import { assertInvariants } from './support/invariants.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: fresh schema, current restart and version validation`, async () => {
    const fixture = await disposableBackend(backend);
    try {
      const connection = await initializeDatabase(fixture.config);
      try {
        await verifyCurrent(connection);
        assert.equal((await sql`select * from users`.execute(connection.db)).rows.length, 0);
        await assertSchema(connection.db, backend);
        await assertDefaultsAndForeignKeys(connection.db, backend);
        await assertInvariants(connection.db, backend);
        await verifyCurrent(connection);
        assert.equal(
          (
            await sql<{ n: number | string }>`select count(*) as n from storage_migrations`.execute(connection.db)
          ).rows[0]!.n.toString(),
          String(migrations(backend).length),
        );
      } finally {
        await connection.close();
      }
      const restart = await initializeDatabase(fixture.config);
      await restart.close();
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const backend of ['mysql', 'mariadb'] as const) {
  test(`${backend}: timers already running keep their one-per-user key through the upgrade`, async () => {
    const fixture = await disposableBackend(backend);
    try {
      const connection = await openConnection<PhysicalDatabase>(fixture.config);
      try {
        await migrate(connection, migrations(backend).slice(0, 3));
        const times = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
        await insert(connection.db, backend, 'workspaces', { id: 1, name: 'scope', ...times });
        for (const id of [1, 2])
          await insert(connection.db, backend, 'users', {
            id,
            email: `user${id}`,
            password_hash: 'hash',
            api_token: `token${id}`,
            ...times,
          });
        const entry = (id: number, user_id: number, stop: string | null) =>
          insert(connection.db, backend, 'time_entries', {
            id,
            workspace_id: 1,
            user_id,
            start: '2026-10-01T00:00:00.000Z',
            stop,
            ...times,
          });
        await entry(1, 1, null);
        await entry(2, 1, '2026-10-01T01:00:00.000Z');
        await entry(3, 2, null);
        await migrate(connection);
        const slots = async () =>
          (await rows(connection.db, backend, 'running_entries'))
            .map(row => [Number(row.user_id), Number(row.entry_id)])
            .sort((a, b) => a[0]! - b[0]!);
        assert.deepEqual(await slots(), [
          [1, 1],
          [2, 3],
        ]);
        await assert.rejects(entry(4, 1, null));
        await assert.rejects(sql`update time_entries set stop = null where id = 2`.execute(connection.db));
        await sql`update time_entries set stop = '2026-10-01T02:00:00.000Z' where id = 1`.execute(connection.db);
        await sql`update time_entries set stop = null where id = 2`.execute(connection.db);
        assert.deepEqual(await slots(), [
          [1, 2],
          [2, 3],
        ]);
        // The upgrade ends with the full current schema, rate-limit tables included.
        await assertSchema(connection.db, backend);
      } finally {
        await connection.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}

test('supported engine lines are explicit and errors contain no supplied version text', async () => {
  const { assertSupportedEngine } = await import('../../src/storage/migrations.ts');
  for (const [backend, version] of [
    ['postgres', 'PostgreSQL 17.9 secret'],
    ['mysql', '11.8.9-MariaDB secret'],
    ['mariadb', '8.4.13 secret'],
    ['sqlite', '3.40.0 secret'],
  ] as const) {
    assert.throws(
      () => assertSupportedEngine(backend, version),
      error => {
        assert.match(String(error), /unsupported-engine/);
        assert.doesNotMatch(String(error), /secret/);
        return true;
      },
    );
  }
});
