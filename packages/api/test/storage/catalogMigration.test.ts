import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'kysely';
import { openConnection } from '../../src/storage/connections.ts';
import { initializeDatabase, migrate, migrations, schemaFingerprint } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createCatalogRepositories } from '../../src/storage/repositories/catalogs.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import * as catalog from '../../src/domain/catalogs.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: upgrade preserves integer estimates, then round-trips fractional and large finite estimates`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    let connection = await openConnection<PhysicalDatabase>(fixture.config);
    const at = '2026-01-01T00:00:00.000Z';
    try {
      const available = migrations(backend);
      // These two shipped versions must stay byte-for-byte unchanged.
      assert.deepEqual(available.slice(0, 2).map(m => createHash('sha256').update(JSON.stringify(m)).digest('hex')), originalHashes[backend]);
      await migrate(connection, available.slice(0, 2));
      await connection.db.insertInto('workspaces').values({ id: 1, name: 'Catalog', created_at: at, updated_at: at }).execute();
      await connection.db.insertInto('projects').values({ id: 1000, workspace_id: 1, client_id: null, name: 'Existing', color: '#abcdef', estimated_hours: null, rate: null, currency: null, fixed_fee: null, start_date: null, end_date: null, created_at: at, updated_at: at }).execute();
      await connection.db.insertInto('tasks').values({ id: 1, workspace_id: 1, project_id: 1000, name: 'Existing', estimated_seconds: 42, created_at: at, updated_at: at }).execute();
      const before = await schemaFingerprint(connection.db, backend);
      const oldLedger = await connection.db.selectFrom('storage_migrations').selectAll().orderBy('version').execute();
      await connection.close();
      connection = await initializeDatabase(fixture.config);
      assert.deepEqual((await connection.db.selectFrom('storage_migrations').selectAll().orderBy('version').execute()).slice(0, 2), oldLedger);
      if (backend === 'sqlite') assert.equal(await schemaFingerprint(connection.db, backend), before);
      const runner = createTransactionRunner(connection, db => createCatalogRepositories(db, backend));
      assert.equal((await runner.readSnapshot(r => r.tasks.getMetadata(1, 1)))?.estimatedSeconds, 42);
      const effects: catalog.CatalogTimerEffects = { async prepare() { return { async settle() {}, async publish() {} }; }, async removeTagFromPauseChains() {} };
      for (const estimate of [1.5, 0.125, 9007199254740992, 1e100, null]) {
        const updated = await runner.transaction(ctx => catalog.updateTask(ctx, 1, 1000, 1, { estimated_seconds: estimate }, effects));
        assert.equal(catalog.serializeTask(updated).estimated_seconds, estimate);
      }
      const large = await runner.transaction(ctx => catalog.createProject(ctx, 1, { name: 'Large', estimated_hours: 1e100, fixed_fee: 1e100 }));
      assert.equal(large.estimatedHours, 1e100); assert.equal(large.fixedFee, 1e100);
      assert.equal((await sql<{ n: number | string }>`select count(*) as n from storage_migrations`.execute(connection.db)).rows[0]!.n.toString(), String(available.length));
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}

const originalHashes = {
  "sqlite": [
    "83f4c4b858e12f70e7fb252403896eb9a8e9408644d0148a9d229f94e3352a25",
    "795a23b7788d6677d7a13f585c10abd149385f4a82cfb4b90653eae6bb9f2965"
  ],
  "postgres": [
    "9f92a57daa0144f6fb517f29a5b5794c01c654ea0c7aa06cb51f17ba6ee11d18",
    "795a23b7788d6677d7a13f585c10abd149385f4a82cfb4b90653eae6bb9f2965"
  ],
  "mysql": [
    "53bb2c8dc0846e54a74308f28b057858a2651836dad8dc14827536dbe19f6862",
    "277462aec09c16b9464a111784611d40d11da1bdea0b0fed26c8784633b2044f"
  ],
  "mariadb": [
    "89deb10ca9a71804917b17551cf494fab1a63401dae827641f600f3a32d9f0c4",
    "277462aec09c16b9464a111784611d40d11da1bdea0b0fed26c8784633b2044f"
  ]
};
