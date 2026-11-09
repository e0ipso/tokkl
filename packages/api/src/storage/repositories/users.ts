/** User accounts: credentials, access, profile and preferences. */
import { now } from '../../lib/clock.ts';
import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { AccountChanges, NewAccount } from '../../domain/ports.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { entityId, jsonObject, safeInteger } from '../conversion.ts';
import { generatedId, getUser, user, type AccountRepositories } from './account-rows.ts';

/** A new account gets its own workspace, so the user repository writes through `workspaces`. */
export function createUserRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  workspaces: Pick<AccountRepositories['workspaces'], 'create' | 'addMember'>,
): AccountRepositories['users'] {
  const users: AccountRepositories['users'] = {
    async count() {
      return safeInteger((await db.selectFrom('users').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    },
    async countActiveAdmins() {
      return safeInteger(
        (
          await db
            .selectFrom('users')
            .select(db.fn.countAll().as('n'))
            .where('role', '=', 'admin')
            .where('disabled_at', 'is', null)
            .executeTakeFirstOrThrow()
        ).n,
      );
    },
    get: id => getUser(db, id),
    async getWithTimerRevision(id) {
      const row = await db
        .selectFrom('users')
        .leftJoin('timer_states', 'timer_states.user_id', 'users.id')
        .selectAll('users')
        .select('timer_states.revision as timer_revision')
        .where('users.id', '=', entityId(id))
        .executeTakeFirst();
      return (
        row && { user: user(row), timerRevision: row.timer_revision === null ? 0 : safeInteger(row.timer_revision) }
      );
    },
    async findByEmail(email) {
      const folded = email.replace(/[A-Z]/g, c => c.toLowerCase());
      const key = backend === 'mysql' || backend === 'mariadb' ? Buffer.from(folded) : folded;
      const row = await db.selectFrom('users').selectAll().where('email_key', '=', key).executeTakeFirst();
      return row ? user(row) : undefined;
    },
    async findByApiToken(token) {
      const row = await db.selectFrom('users').selectAll().where('api_token', '=', token).executeTakeFirst();
      return row ? user(row) : undefined;
    },
    async list() {
      return (await db.selectFrom('users').selectAll().orderBy('id').execute()).map(user);
    },
    async createAccount(input: NewAccount) {
      const ws = await workspaces.create(`${input.fullName || 'My'} workspace`.trim());
      const at = now();
      const query = db.insertInto('users').values({
        email: input.email,
        fullname: input.fullName,
        password_hash: input.passwordHash,
        api_token: input.apiToken,
        timezone: input.timezone,
        default_workspace_id: ws.id,
        preferences: JSON.stringify(jsonObject(input.preferences)),
        role: input.role,
        disabled_at: null,
        created_at: at,
        updated_at: at,
      });
      const id =
        backend === 'postgres'
          ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id)
          : await generatedId(query);
      await workspaces.addMember({ workspaceId: ws.id, userId: id, role: 'owner' });
      return (await getUser(db, id))!;
    },
    async updateAccount(id, changes: AccountChanges) {
      await db
        .updateTable('users')
        .set({
          ...(changes.email === undefined ? {} : { email: changes.email }),
          ...(changes.fullName === undefined ? {} : { fullname: changes.fullName }),
          ...(changes.timezone === undefined ? {} : { timezone: changes.timezone }),
          ...(changes.beginningOfWeek === undefined ? {} : { beginning_of_week: changes.beginningOfWeek }),
          ...(changes.defaultWorkspaceId === undefined
            ? {}
            : { default_workspace_id: entityId(changes.defaultWorkspaceId) }),
          updated_at: now(),
        })
        .where('id', '=', entityId(id))
        .execute();
      return (await getUser(db, id))!;
    },
    async setPreferences(id, preferences) {
      await db
        .updateTable('users')
        .set({ preferences: JSON.stringify(jsonObject(preferences)), updated_at: now() })
        .where('id', '=', entityId(id))
        .execute();
    },
    async changeCredentials(id, expectedPasswordHash, passwordHash, apiToken) {
      return (
        (
          await db
            .updateTable('users')
            .set({ password_hash: passwordHash, api_token: apiToken, updated_at: now() })
            .where('id', '=', entityId(id))
            .where('password_hash', '=', expectedPasswordHash)
            .where('disabled_at', 'is', null)
            .executeTakeFirstOrThrow()
        ).numUpdatedRows === 1n
      );
    },
    async rotateApiToken(id, apiToken) {
      await db
        .updateTable('users')
        .set({ api_token: apiToken, updated_at: now() })
        .where('id', '=', entityId(id))
        .execute();
    },
    async setAccess(id, accessRole, disabledAt) {
      await db
        .updateTable('users')
        .set({ role: accessRole, disabled_at: disabledAt, updated_at: now() })
        .where('id', '=', entityId(id))
        .execute();
      return (await getUser(db, id))!;
    },
    async delete(id) {
      await db.deleteFrom('users').where('id', '=', entityId(id)).execute();
    },
  };
  return users;
}
