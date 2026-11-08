import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { IdempotencyKeysRepository } from '../contracts.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { entityId, utcInstant } from '../conversion.ts';
import { classifyConflict, StorageConflict } from '../errors.ts';

/** Most expired records one write deletes. Later writes take the rest. */
const CLEANUP_BATCH = 100;

export function createIdempotencyKeysRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
): IdempotencyKeysRepository {
  const server = backend !== 'sqlite';
  return {
    async find(keyHash) {
      const row = await db
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('key_hash', '=', keyHash)
        .executeTakeFirst();
      return (
        row && {
          keyHash: row.key_hash,
          userId: entityId(row.user_id),
          fingerprint: row.fingerprint,
          resultId: entityId(row.result_id),
          createdAt: utcInstant(row.created_at),
        }
      );
    },
    async insert(record) {
      try {
        await db
          .insertInto('idempotency_keys')
          .values({
            key_hash: record.keyHash,
            user_id: record.userId,
            fingerprint: record.fingerprint,
            result_id: record.resultId,
            created_at: record.createdAt,
          })
          .execute();
      } catch (error) {
        // A concurrent request with the same key committed first. Running again finds its record.
        if (classifyConflict(error)?.kind === 'unique') throw new StorageConflict('serialization');
        throw error;
      }
    },
    async delete(keyHash) {
      await db.deleteFrom('idempotency_keys').where('key_hash', '=', keyHash).execute();
    },
    async deleteExpired(before) {
      let expired = db
        .selectFrom('idempotency_keys')
        .select('key_hash')
        .where('created_at', '<', before)
        .limit(CLEANUP_BATCH);
      if (server) expired = expired.forUpdate().skipLocked();
      const keys = (await expired.execute()).map(row => row.key_hash);
      if (keys.length) await db.deleteFrom('idempotency_keys').where('key_hash', 'in', keys).execute();
    },
  };
}
