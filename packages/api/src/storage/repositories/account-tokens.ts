/** Invite and password reset tokens, and sign-in sessions, all stored as hashes. */
import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { entityId, utcInstant } from '../conversion.ts';
import { accountToken, generatedId, nullableInstant, type AccountRepositories } from './account-rows.ts';

/** Most rows one cleanup call deletes. The maintenance job calls again for the rest. */
const CLEANUP_BATCH = 100;

export function createTokenRepository(db: Kysely<PhysicalDatabase>, backend: Backend): AccountRepositories['tokens'] {
  return {
    async create(input) {
      const query = db.insertInto('account_tokens').values({
        token_hash: input.tokenHash,
        kind: input.kind,
        role: input.role,
        note: input.note,
        user_id: input.userId,
        created_by: input.createdBy,
        created_at: utcInstant(input.createdAt),
        expires_at: utcInstant(input.expiresAt),
        used_at: nullableInstant(input.usedAt),
      });
      const id =
        backend === 'postgres'
          ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id)
          : await generatedId(query);
      return accountToken(
        await db.selectFrom('account_tokens').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
      );
    },
    async listPendingInvites(at) {
      return (
        await db
          .selectFrom('account_tokens')
          .selectAll()
          .where('kind', '=', 'invite')
          .where('used_at', 'is', null)
          .where('expires_at', '>', utcInstant(at))
          .orderBy('id')
          .execute()
      ).map(accountToken);
    },
    async findUsable(hash, kind, at) {
      const row = await db
        .selectFrom('account_tokens')
        .selectAll()
        .where('token_hash', '=', hash)
        .where('kind', '=', kind)
        .where('used_at', 'is', null)
        .where('expires_at', '>', utcInstant(at))
        .executeTakeFirst();
      return row ? accountToken(row) : undefined;
    },
    async consume(id, at, userId) {
      return (
        (
          await db
            .updateTable('account_tokens')
            .set({ used_at: utcInstant(at), ...(userId === undefined ? {} : { user_id: entityId(userId) }) })
            .where('id', '=', entityId(id))
            .where('used_at', 'is', null)
            .where('expires_at', '>', utcInstant(at))
            .executeTakeFirstOrThrow()
        ).numUpdatedRows === 1n
      );
    },
    async revokeInvite(id) {
      return (
        (
          await db
            .deleteFrom('account_tokens')
            .where('id', '=', entityId(id))
            .where('kind', '=', 'invite')
            .where('used_at', 'is', null)
            .executeTakeFirstOrThrow()
        ).numDeletedRows > 0n
      );
    },
    async revokeInvitesCreatedBy(id) {
      await db
        .deleteFrom('account_tokens')
        .where('created_by', '=', entityId(id))
        .where('kind', '=', 'invite')
        .where('used_at', 'is', null)
        .execute();
    },
    async revokeUnusedPasswordResets(id) {
      await db
        .deleteFrom('account_tokens')
        .where('user_id', '=', entityId(id))
        .where('kind', '=', 'password_reset')
        .where('used_at', 'is', null)
        .execute();
    },
    async deleteSpent(at) {
      let spent = db
        .selectFrom('account_tokens')
        .select('id')
        .where(eb => eb.or([eb('used_at', 'is not', null), eb('expires_at', '<=', utcInstant(at))]))
        .limit(CLEANUP_BATCH);
      if (backend !== 'sqlite') spent = spent.forUpdate().skipLocked();
      const ids = (await spent.execute()).map(row => row.id);
      if (ids.length) await db.deleteFrom('account_tokens').where('id', 'in', ids).execute();
      return ids.length;
    },
  };
}

export function createSessionRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
): AccountRepositories['sessions'] {
  return {
    async create(input) {
      await db
        .insertInto('sessions')
        .values({
          token_hash: input.tokenHash,
          user_id: entityId(input.userId),
          created_at: utcInstant(input.createdAt),
          expires_at: utcInstant(input.expiresAt),
          user_agent: input.userAgent.slice(0, 255),
        })
        .execute();
    },
    async find(hash) {
      const row = await db.selectFrom('sessions').selectAll().where('token_hash', '=', hash).executeTakeFirst();
      return row
        ? {
            tokenHash: row.token_hash,
            userId: entityId(row.user_id),
            createdAt: utcInstant(row.created_at),
            expiresAt: utcInstant(row.expires_at),
            userAgent: row.user_agent,
          }
        : undefined;
    },
    async delete(hash) {
      await db.deleteFrom('sessions').where('token_hash', '=', hash).execute();
    },
    async deleteForUser(id, keep) {
      let query = db.deleteFrom('sessions').where('user_id', '=', entityId(id));
      if (keep !== undefined) query = query.where('token_hash', '!=', keep);
      await query.execute();
    },
    async deleteExpired(at) {
      let expired = db
        .selectFrom('sessions')
        .select('token_hash')
        .where('expires_at', '<', utcInstant(at))
        .limit(CLEANUP_BATCH);
      if (backend !== 'sqlite') expired = expired.forUpdate().skipLocked();
      const hashes = (await expired.execute()).map(row => row.token_hash);
      if (hashes.length) await db.deleteFrom('sessions').where('token_hash', 'in', hashes).execute();
      return hashes.length;
    },
  };
}
