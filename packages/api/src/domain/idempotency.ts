/**
 * Idempotent creates. A create that comes with an `Idempotency-Key` records the key with the
 * digest of its request and the id of what it made, in the create's own transaction. The same key
 * with the same request within `IDEMPOTENCY_RETENTION_MS` answers that record as it is now and
 * creates nothing; with a different request it gets a 422. A failed create records nothing, so it
 * may be sent again with its key.
 *
 * Two requests with one key at once create once: the later one's record collides with the first
 * one's on the primary key, its transaction rolls back and runs again, and then finds the record.
 */
import type { IdempotencyKeysRepository } from '../storage/contracts.ts';
import type { Id } from '../storage/domain.ts';
import { sha256 } from '../lib/crypto.ts';
import { unprocessable } from '../lib/errors.ts';
import { IDEMPOTENCY_KEY_HEADER, type IdempotencyClaim } from '../lib/idempotency.ts';

/** How long a key answers with its original result. An older key is forgotten and may be used again. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

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
  now = new Date(),
): Promise<T> {
  if (!claim) return steps.create();
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS).toISOString();
  await ctx.idempotencyKeys.deleteExpired(cutoff);
  const keyHash = sha256(`${userId}\n${claim.key}`);
  const recorded = await ctx.idempotencyKeys.find(keyHash);
  if (recorded && recorded.createdAt >= cutoff) {
    if (recorded.fingerprint !== claim.fingerprint)
      throw unprocessable(`This ${IDEMPOTENCY_KEY_HEADER} was already used with a different request`);
    return steps.replay(recorded.resultId);
  }
  // An expired record that cleanup skipped because another write held it.
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
