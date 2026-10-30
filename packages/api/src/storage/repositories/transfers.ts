import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../contracts.ts';
import type { AccountExportProjection, MembershipRole, UserRole } from '../domain.ts';
import { entityId, finiteNumber, jsonObject, safeInteger, utcInstant } from '../conversion.ts';
import { catalogProjectQuery, catalogTaskQuery } from './catalogs.ts';
import { createEntryRepositories } from './entries.ts';
import { client, tag, projectSummary, taskSummary } from './transfer-projections.ts';

/** The caller owns the consistent snapshot; every projection uses this supplied handle. */
export function createTransferRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): Pick<Repositories, 'transfers'> {
  return { transfers: {
    async hasRunningEntry(userId) {
      return !!await db.selectFrom('time_entries').select('id').where('user_id', '=', userId)
        .where('stop', 'is', null).where('deleted_at', 'is', null).executeTakeFirst();
    },
    async exportAccount(userId): Promise<AccountExportProjection> {
      // Credentials never enter the projection, even transiently.
      const u = await db.selectFrom('users').select(['id', 'email', 'fullname', 'timezone', 'beginning_of_week',
        'default_workspace_id', 'preferences', 'role', 'disabled_at', 'created_at', 'updated_at']).where('id', '=', userId).executeTakeFirstOrThrow();
      if (u.role !== 'admin' && u.role !== 'user') throw new Error('Invalid storage account role');
      const user = { id: entityId(u.id), email: u.email, fullName: u.fullname, timezone: u.timezone,
        beginningOfWeek: safeInteger(u.beginning_of_week), defaultWorkspaceId: entityId(u.default_workspace_id), preferences: jsonObject(u.preferences),
        role: u.role as UserRole, disabledAt: u.disabled_at === null ? null : utcInstant(u.disabled_at),
        createdAt: utcInstant(u.created_at), updatedAt: utcInstant(u.updated_at) };
      const memberships = (await db.selectFrom('workspace_users').selectAll().where('user_id', '=', userId).orderBy('workspace_id').execute()).map(m => {
        if (m.role !== 'owner' && m.role !== 'member') throw new Error('Invalid storage membership role');
        return { userId, workspaceId: entityId(m.workspace_id), role: m.role as MembershipRole };
      });
      const scope = db.selectFrom('workspace_users').select('workspace_id').where('user_id', '=', userId);
      const workspaces = (await db.selectFrom('workspaces').selectAll().where('id', 'in', scope).orderBy('id').execute()).map(w => ({
        id: entityId(w.id), name: w.name, defaultCurrency: w.default_currency, defaultHourlyRate: w.default_hourly_rate === null ? null : finiteNumber(w.default_hourly_rate),
        rounding: safeInteger(w.rounding), roundingMinutes: safeInteger(w.rounding_minutes), createdAt: utcInstant(w.created_at), updatedAt: utcInstant(w.updated_at),
      }));
      const clients = (await db.selectFrom('clients').selectAll().where('workspace_id', 'in', scope).orderBy('workspace_id').orderBy('name_key').orderBy('id').execute()).map(client);
      const projects = (await catalogProjectQuery(db, backend).where('p.workspace_id', 'in', scope).orderBy('p.workspace_id').orderBy('p.name_key').orderBy('p.id').execute()).map(projectSummary);
      const tasks = (await catalogTaskQuery(db, backend).where('t.workspace_id', 'in', scope).orderBy('t.workspace_id').orderBy('t.name_key').orderBy('t.id').execute()).map(taskSummary);
      const tags = (await db.selectFrom('tags').selectAll().where('workspace_id', 'in', scope).orderBy('workspace_id').orderBy('name_key').orderBy('id').execute()).map(tag);
      const entries = await createEntryRepositories(db, backend).entries.list(userId);
      return { user, memberships, workspaces, clients, projects, tasks, tags, entries };
    },
  } };
}
