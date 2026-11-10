import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'kysely';
import { openConnection } from '../../src/storage/connections.ts';
import { assertSupportedEngine, runMigrations } from '../../src/storage/migrationRunner.ts';
import { initializeDatabase, migrations } from '../../src/storage/migrations.ts';
import { assertCurrent } from './support/migrationLedger.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { assertSchema, assertDefaultsAndForeignKeys, insert, rows } from './support/schemaAssertions.ts';
import { assertInvariants } from './support/invariants.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { IDLE_TIMER_FINGERPRINT } from '../../src/domain/timerFingerprint.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';

test('shipped migrations retain their checksums', () => {
  const hashes = {
    sqlite: '8dbdb4af3ef136372e25a206614cb9128b34a77a7feeb51a9aab382696c1d80c',
    postgres: 'a28cd72accc541184e41aea2bf37afce25d610b85aacbfc451466cf8ce598122',
    mysql: '184e5230b4dd9f287d59dc6df9afb347bcc1002f57ed7cc6bf8ba2e186d64c2e',
    mariadb: 'f9f5fd1e27276dd3fe2665b65180314244994a785091463257c234063fb975ca',
  };
  for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify(migrations(backend).slice(0, 8)))
        .digest('hex'),
      hashes[backend],
    );
  }
});

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: fresh schema, current restart and version validation`, async () => {
    const fixture = await disposableBackend(backend);
    try {
      const connection = await initializeDatabase(fixture.config);
      try {
        await assertCurrent(connection);
        assert.equal((await sql`select * from users`.execute(connection.db)).rows.length, 0);
        await assertSchema(connection.db, backend);
        await assertDefaultsAndForeignKeys(connection.db, backend);
        await assertInvariants(connection.db, backend);
        await assertCurrent(connection);
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
        await runMigrations(connection, migrations(backend).slice(0, 3));
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
        await runMigrations(connection, migrations(backend));
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
        await assertSchema(connection.db, backend);
      } finally {
        await connection.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: the upgrade copies each revision's session entry out of its fingerprint`, async () => {
    const fixture = await disposableBackend(backend);
    try {
      const connection = await openConnection<PhysicalDatabase>(fixture.config);
      try {
        const available = migrations(backend);
        const version = available.findIndex(m => m.name === 'timer_session_entry');
        await runMigrations(connection, available.slice(0, version));
        const session = { userId: 1, entryId: 7, config: {}, phase: {} };
        const fingerprints: Array<[string, number | null]> = [
          [JSON.stringify({ running: { id: 7 }, session, chain: null }), 7],
          [IDLE_TIMER_FINGERPRINT, null],
          ['not json', null],
          ['[]', null],
          ['{"session":{"entryId":"7"}}', null],
          ['{"session":{"entryId":1.5}}', null],
          ['{"session":null}', null],
        ];
        const times = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
        for (const [index, [fingerprint]] of fingerprints.entries()) {
          const id = index + 1;
          await insert(connection.db, backend, 'users', {
            id,
            email: `user${id}`,
            password_hash: 'hash',
            api_token: `token${id}`,
            ...times,
          });
          await insert(connection.db, backend, 'timer_states', { user_id: id, revision: 3, fingerprint });
        }
        await runMigrations(connection, migrations(backend));
        const stored = new Map(
          (await rows(connection.db, backend, 'timer_states')).map(row => [
            Number(row.user_id),
            row.session_entry_id === null ? null : Number(row.session_entry_id),
          ]),
        );
        assert.deepEqual(
          fingerprints.map((_, index) => stored.get(index + 1)),
          fingerprints.map(([, expected]) => expected),
        );
        await assertSchema(connection.db, backend);
      } finally {
        await connection.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: the upgrade starts every workspace's catalog revision at 0`, async () => {
    const fixture = await disposableBackend(backend);
    try {
      const connection = await openConnection<PhysicalDatabase>(fixture.config);
      try {
        const available = migrations(backend);
        await runMigrations(
          connection,
          available.slice(
            0,
            available.findIndex(m => m.name === 'catalog_revision'),
          ),
        );
        const times = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
        for (const id of [1, 2]) await insert(connection.db, backend, 'workspaces', { id, name: `ws${id}`, ...times });
        await runMigrations(connection, migrations(backend));
        assert.deepEqual(
          (await rows(connection.db, backend, 'workspaces'))
            .map(row => [Number(row.id), Number(row.catalog_revision)])
            .sort((a, b) => a[0]! - b[0]!),
          [
            [1, 0],
            [2, 0],
          ],
        );
        await assertSchema(connection.db, backend);
      } finally {
        await connection.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: token email upgrade preserves existing links and migration history`, async () => {
    const available = migrations(backend);
    assert.equal(available.at(-1)?.name, 'account_token_email');
    // Cover both earlier supported schemas.
    for (const previous of [5, 8]) {
      const fixture = await disposableBackend(backend);
      let connection = await openConnection<PhysicalDatabase>(fixture.config);
      const at = '2026-10-01T00:00:00.000Z';
      try {
        await runMigrations(connection, available.slice(0, previous));
        for (const kind of ['invite', 'password_reset'])
          await insert(connection.db, backend, 'account_tokens', {
            token_hash: kind,
            kind,
            role: kind === 'invite' ? 'user' : null,
            created_at: at,
            expires_at: '2026-11-01T00:00:00.000Z',
          });
        const ledger = await connection.db.selectFrom('storage_migrations').selectAll().orderBy('version').execute();
        await connection.close();
        connection = await initializeDatabase(fixture.config);
        assert.deepEqual(
          (await connection.db.selectFrom('storage_migrations').selectAll().orderBy('version').execute()).slice(
            0,
            previous,
          ),
          ledger,
        );
        const { tokens } = createAccountRepositories(connection.db, backend);
        for (const kind of ['invite', 'password_reset'] as const) {
          const token = await tokens.findUsable(kind, kind, at);
          assert.ok(token);
          assert.equal(token.email, null);
        }
        assert.equal((await tokens.listPendingInvites(at))[0]!.email, null);
        await assertSchema(connection.db, backend);
        await assertCurrent(connection);
        await connection.close();
        connection = await initializeDatabase(fixture.config);
        await assertCurrent(connection);
      } finally {
        await connection.close();
        await fixture.cleanup();
      }
    }
  });
}

test('supported engine lines are explicit and errors contain no supplied version text', async () => {
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
