/**
 * Idempotent creates. A create that comes with an `Idempotency-Key` records the key with the
 * digest of its request and the id of what it made, in the create's own transaction. The same key
 * with the same request within `IDEMPOTENCY_RETENTION_MS` answers that record as it is now and
 * creates nothing; with a different request it gets a 422. A failed create records nothing, so it
 * may be sent again with its key.
 *
 * Two requests with one key at once create once: the later one's record collides with the first
 * one's on the primary key, its transaction rolls back and runs again, and then finds the record.
 *
 * A create never deletes other users' expired records while it holds its locks. The maintenance
 * job (`services/maintenance.ts`) forgets them; until then a create ignores an expired record.
 */
import type { IdempotencyKeysRepository } from './ports.ts';
import type { Id } from './model.ts';
import { sha256 } from '../lib/crypto.ts';
import { unprocessable } from '../lib/errors.ts';
import { IDEMPOTENCY_KEY_HEADER, type IdempotencyClaim } from '../lib/idempotency.ts';

/** How long a key answers with its original result. An older key is forgotten and may be used again. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Records created before this instant are past the retention. */
export const idempotencyCutoff = (now: Date) => new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS).toISOString();

/** How one kind of create runs, names its result, and answers again for a recorded one. */
export interface IdempotentCreate<T> {
  create(): Promise<T>;
  /** The id `replay` reads the result back by. */
  reference(result: T): Id;
  /** The result of the recorded create, read as it is now. */
  replay(resultId: Id): Promise<T>;
}

/** Runs `steps.create` once per key: without a claim it simply creates. */
export async function idempotent<T>(
  ctx: { idempotencyKeys: IdempotencyKeysRepository },
  userId: Id,
  claim: IdempotencyClaim | undefined,
  steps: IdempotentCreate<T>,
): Promise<T> {
  if (!claim) return steps.create();
  const now = new Date();
  const cutoff = idempotencyCutoff(now);
  const keyHash = sha256(`${userId}\n${claim.key}`);
  const recorded = await ctx.idempotencyKeys.find(keyHash);
  if (recorded && recorded.createdAt >= cutoff) {
    if (recorded.fingerprint !== claim.fingerprint)
      throw unprocessable(`This ${IDEMPOTENCY_KEY_HEADER} was already used with a different request`);
    return steps.replay(recorded.resultId);
  }
  // An expired record the maintenance job has not deleted yet.
  if (recorded) await ctx.idempotencyKeys.delete(keyHash);
  const result = await steps.create();
  await ctx.idempotencyKeys.insert({
    keyHash,
    userId,
    fingerprint: claim.fingerprint,
    resultId: steps.reference(result),
    createdAt: now.toISOString(),
  });
  return result;
}
