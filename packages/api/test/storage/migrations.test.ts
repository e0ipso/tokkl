import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'kysely';
import { initializeDatabase, verifyCurrent } from '../../src/storage/migrations.ts';
import { assertSchema, assertDefaultsAndForeignKeys } from './support/schemaAssertions.ts';
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
        assert.equal((await sql<{ n: number | string }>`select count(*) as n from storage_migrations`.execute(connection.db)).rows[0]!.n.toString(), '2');
      } finally { await connection.close(); }
      const restart = await initializeDatabase(fixture.config);
      await restart.close();
    } finally { await fixture.cleanup(); }
  });
}

test('supported engine lines are explicit and errors contain no supplied version text', async () => {
  const { assertSupportedEngine } = await import('../../src/storage/migrations.ts');
  for (const [backend, version] of [['postgres', 'PostgreSQL 17.9 secret'], ['mysql', '11.8.9-MariaDB secret'], ['mariadb', '8.4.13 secret'], ['sqlite', '3.40.0 secret']] as const) {
    assert.throws(() => assertSupportedEngine(backend, version), error => {
      assert.match(String(error), /unsupported-engine/); assert.doesNotMatch(String(error), /secret/); return true;
    });
  }
});
