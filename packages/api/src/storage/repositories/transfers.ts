import type { Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../contracts.ts';
import type { AccountExportProjection, MembershipRole, UserRole } from '../domain.ts';
import { entityId, finiteNumber, jsonObject, safeInteger, utcInstant } from '../conversion.ts';
import { catalogProjectQuery, catalogTaskQuery, client, projectSummary, tag, taskSummary } from './catalog-queries.ts';
import { createEntryRepositories } from './entries.ts';

type Db = Kysely<PhysicalDatabase>;
type Projection<K extends keyof AccountExportProjection> = Promise<AccountExportProjection[K]>;

/** Credentials never enter the projection, even transiently. */
async function exportedUser(db: Db, userId: number): Projection<'user'> {
  const u = await db
    .selectFrom('users')
    .select([
      'id',
      'email',
      'fullname',
      'timezone',
      'beginning_of_week',
      'default_workspace_id',
      'preferences',
      'role',
      'disabled_at',
      'created_at',
      'updated_at',
    ])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (u.role !== 'admin' && u.role !== 'user') throw new Error('Invalid storage account role');
  return {
    id: entityId(u.id),
    email: u.email,
    fullName: u.fullname,
    timezone: u.timezone,
    beginningOfWeek: safeInteger(u.beginning_of_week),
    defaultWorkspaceId: entityId(u.default_workspace_id),
    preferences: jsonObject(u.preferences),
    role: u.role as UserRole,
    disabledAt: u.disabled_at === null ? null : utcInstant(u.disabled_at),
    createdAt: utcInstant(u.created_at),
    updatedAt: utcInstant(u.updated_at),
  };
}

async function exportedMemberships(db: Db, userId: number): Projection<'memberships'> {
  const rows = await db
    .selectFrom('workspace_users')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('workspace_id')
    .execute();
  return rows.map(m => {
    if (m.role !== 'owner' && m.role !== 'member') throw new Error('Invalid storage membership role');
    return { userId, workspaceId: entityId(m.workspace_id), role: m.role as MembershipRole };
  });
}

/** The ids of the user's workspaces, as a subquery each projection below filters by. */
function memberScope(db: Db, userId: number) {
  return db.selectFrom('workspace_users').select('workspace_id').where('user_id', '=', userId);
}
type Scope = ReturnType<typeof memberScope>;

async function exportedWorkspaces(db: Db, scope: Scope): Projection<'workspaces'> {
  const rows = await db.selectFrom('workspaces').selectAll().where('id', 'in', scope).orderBy('id').execute();
  return rows.map(w => ({
    id: entityId(w.id),
    name: w.name,
    defaultCurrency: w.default_currency,
    defaultHourlyRate: w.default_hourly_rate === null ? null : finiteNumber(w.default_hourly_rate),
    rounding: safeInteger(w.rounding),
    roundingMinutes: safeInteger(w.rounding_minutes),
    createdAt: utcInstant(w.created_at),
    updatedAt: utcInstant(w.updated_at),
  }));
}

async function exportedClients(db: Db, scope: Scope): Projection<'clients'> {
  const rows = await db
    .selectFrom('clients')
    .selectAll()
    .where('workspace_id', 'in', scope)
    .orderBy('workspace_id')
    .orderBy('name_key')
    .orderBy('id')
    .execute();
  return rows.map(client);
}

async function exportedProjects(db: Db, backend: Backend, scope: Scope): Projection<'projects'> {
  const rows = await catalogProjectQuery(db, backend)
    .where('p.workspace_id', 'in', scope)
    .orderBy('p.workspace_id')
    .orderBy('p.name_key')
    .orderBy('p.id')
    .execute();
  return rows.map(projectSummary);
}

async function exportedTasks(db: Db, backend: Backend, scope: Scope): Projection<'tasks'> {
  const rows = await catalogTaskQuery(db, backend)
    .where('t.workspace_id', 'in', scope)
    .orderBy('t.workspace_id')
    .orderBy('t.name_key')
    .orderBy('t.id')
    .execute();
  return rows.map(taskSummary);
}

async function exportedTags(db: Db, scope: Scope): Projection<'tags'> {
  const rows = await db
    .selectFrom('tags')
    .selectAll()
    .where('workspace_id', 'in', scope)
    .orderBy('workspace_id')
    .orderBy('name_key')
    .orderBy('id')
    .execute();
  return rows.map(tag);
}

/** The caller owns the consistent snapshot; every projection uses this supplied handle. */
export function createTransferRepositories(db: Db, backend: Backend): Pick<Repositories, 'transfers'> {
  return {
    transfers: {
      // One projection at a time, in this order, on the caller's connection.
      async exportAccount(userId): Promise<AccountExportProjection> {
        const user = await exportedUser(db, userId);
        const memberships = await exportedMemberships(db, userId);
        const scope = memberScope(db, userId);
        const workspaces = await exportedWorkspaces(db, scope);
        const clients = await exportedClients(db, scope);
        const projects = await exportedProjects(db, backend, scope);
        const tasks = await exportedTasks(db, backend, scope);
        const tags = await exportedTags(db, scope);
        const entries = await createEntryRepositories(db, backend).entries.list(userId);
        return { user, memberships, workspaces, clients, projects, tasks, tags, entries };
      },
    },
  };
}
