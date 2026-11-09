import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { StorageConnection } from '../../../src/storage/connections.ts';
import { schemaFingerprint } from '../../../src/storage/migrationRunner.ts';
import { migrations } from '../../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';

/**
 * Asserts that the ledger records every migration of the current history, complete and with its
 * checksum, and that the schema still has the fingerprint the last one recorded. It only reads, so
 * it works on a reader connection too.
 */
export async function assertCurrent(connection: StorageConnection<PhysicalDatabase>): Promise<void> {
  const { db, backend } = connection;
  const ledger = await db.selectFrom('storage_migrations').selectAll().orderBy('version').execute();
  assert.deepEqual(
    ledger.map(row => ({ version: Number(row.version), name: row.name, checksum: row.checksum, state: row.state })),
    migrations(backend).map(migration => ({
      version: migration.version,
      name: migration.name,
      checksum: createHash('sha256').update(JSON.stringify(migration)).digest('hex'),
      state: 'complete',
    })),
  );
  assert.equal(ledger.at(-1)!.schema_hash, await schemaFingerprint(db, backend));
}
