/** Workspaces and their members. */
import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import { entityId, safeInteger } from '../conversion.ts';
import { generatedId, getWorkspace, membershipRole, now, workspace, type AccountRepositories } from './account-rows.ts';

export function createWorkspaceRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
): AccountRepositories['workspaces'] {
  const workspaces: AccountRepositories['workspaces'] = {
    get: id => getWorkspace(db, id),
    async forMember(userId, workspaceId) {
      const row = await db
        .selectFrom('workspaces')
        .innerJoin('workspace_users', 'workspace_users.workspace_id', 'workspaces.id')
        .selectAll('workspaces')
        .where('workspace_users.user_id', '=', entityId(userId))
        .where('workspaces.id', '=', entityId(workspaceId))
        .executeTakeFirst();
      return row ? workspace(row) : undefined;
    },
    async listForUser(userId) {
      return (
        await db
          .selectFrom('workspaces')
          .innerJoin('workspace_users', 'workspace_users.workspace_id', 'workspaces.id')
          .selectAll('workspaces')
          .where('workspace_users.user_id', '=', entityId(userId))
          .orderBy('workspaces.id')
          .execute()
      ).map(workspace);
    },
    async create(name) {
      const at = now();
      const query = db
        .insertInto('workspaces')
        .values({ name, created_at: at, updated_at: at, default_hourly_rate: null });
      const id =
        backend === 'postgres'
          ? entityId((await query.returning('id').executeTakeFirstOrThrow()).id)
          : await generatedId(query);
      return (await getWorkspace(db, id))!;
    },
    async update(id, changes) {
      await db
        .updateTable('workspaces')
        .set({
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.defaultCurrency === undefined ? {} : { default_currency: changes.defaultCurrency }),
          ...(changes.defaultHourlyRate === undefined ? {} : { default_hourly_rate: changes.defaultHourlyRate }),
          ...(changes.rounding === undefined ? {} : { rounding: changes.rounding }),
          ...(changes.roundingMinutes === undefined ? {} : { rounding_minutes: changes.roundingMinutes }),
          updated_at: now(),
        })
        .where('id', '=', entityId(id))
        .execute();
      return (await getWorkspace(db, id))!;
    },
    async getRole(userId, workspaceId) {
      const row = await db
        .selectFrom('workspace_users')
        .select('role')
        .where('user_id', '=', entityId(userId))
        .where('workspace_id', '=', entityId(workspaceId))
        .executeTakeFirst();
      return row ? membershipRole(row.role) : undefined;
    },
    async addMember(input) {
      await db
        .insertInto('workspace_users')
        .values({ workspace_id: entityId(input.workspaceId), user_id: entityId(input.userId), role: input.role })
        .execute();
    },
    async countMembers(workspaceId) {
      return safeInteger(
        (
          await db
            .selectFrom('workspace_users')
            .select(db.fn.countAll().as('n'))
            .where('workspace_id', '=', entityId(workspaceId))
            .executeTakeFirstOrThrow()
        ).n,
      );
    },
    async listMembers(workspaceId) {
      return (
        await db
          .selectFrom('workspace_users')
          .innerJoin('users', 'users.id', 'workspace_users.user_id')
          .select(['users.id', 'users.email', 'users.fullname', 'users.timezone', 'workspace_users.role'])
          .where('workspace_id', '=', entityId(workspaceId))
          .orderBy('users.id')
          .execute()
      ).map(row => ({
        userId: entityId(row.id),
        workspaceId: entityId(workspaceId),
        email: row.email,
        fullName: row.fullname,
        timezone: row.timezone,
        role: membershipRole(row.role),
      }));
    },
    async deleteSoleMemberWorkspaces(userId) {
      // The caller holds the instance and all the user's workspace guards before these predicates.
      for (const ws of await workspaces.listForUser(userId)) {
        if ((await workspaces.countMembers(ws.id)) === 1)
          await db.deleteFrom('workspaces').where('id', '=', ws.id).execute();
      }
    },
  };
  return workspaces;
}
