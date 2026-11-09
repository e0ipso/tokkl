/** Tasks of a project, with their project and client names and tracked total. */
import { sql, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories, TaskInput, TaskSearchFilter } from '../../domain/ports.ts';
import { booleanValue, entityId, safeInteger, utcInstant } from '../conversion.ts';
import { StorageConflict } from '../../domain/ports.ts';
import { catalogWrite, containsName, nameKey, taskEstimate } from './catalog-sql.ts';
import {
  catalogTaskQuery,
  catalogTaskRefQuery,
  insertId,
  now,
  required,
  task,
  taskSummary,
} from './catalog-queries.ts';

/** Whether a stored name has a character outside ASCII: more bytes than characters. */
function nonAsciiName(backend: Backend) {
  const name = sql.ref('t.name');
  return backend === 'sqlite'
    ? sql<boolean>`length(${name}) <> length(cast(${name} as blob))`
    : backend === 'postgres'
      ? sql<boolean>`octet_length(${name}) <> char_length(${name})`
      : sql<boolean>`length(${name}) <> char_length(${name})`;
}

/**
 * Keeps the tasks of `wid` that `filter` names. A name search keeps an ASCII name only when its
 * folded key contains the search, which is exactly JavaScript's lower-casing for ASCII, and keeps
 * every other name for the caller's exact test.
 */
function searchScope(backend: Backend, wid: number, filter: TaskSearchFilter & { nameCandidates?: string }) {
  return (eb: ExpressionBuilder<PhysicalDatabase & { t: PhysicalDatabase['tasks'] }, 't'>) => {
    const kept: Expression<SqlBool>[] = [eb('t.workspace_id', '=', wid)];
    if (filter.projectId !== undefined) kept.push(eb('t.project_id', '=', filter.projectId));
    if (filter.active !== undefined) kept.push(eb('t.active', '=', Number(filter.active)));
    if (filter.changedSince !== undefined) kept.push(eb('t.updated_at', '>=', filter.changedSince));
    const needle = filter.nameCandidates;
    if (needle)
      kept.push(
        /^\p{ASCII}*$/u.test(needle)
          ? eb.or([containsName(backend, 't.name_key', needle), nonAsciiName(backend)])
          : nonAsciiName(backend),
      );
    return eb.and(kept);
  };
}

export function createTaskRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  projects: Pick<Repositories['projects'], 'getRef'>,
): Repositories['tasks'] {
  const tasks: Repositories['tasks'] = {
    async getMetadata(wid, id) {
      const r = await db
        .selectFrom('tasks')
        .select(['id', 'workspace_id', 'project_id', 'name', 'active', 'created_at', 'updated_at'])
        .select(taskEstimate(backend, 'estimated_seconds').as('estimated_seconds'))
        .where('workspace_id', '=', wid)
        .where('id', '=', id)
        .executeTakeFirst();
      return r && task(r);
    },
    async list(wid, filter = {}) {
      let q = catalogTaskQuery(db, backend).where('t.workspace_id', '=', wid);
      if (filter.projectId !== undefined) q = q.where('t.project_id', '=', filter.projectId);
      if (filter.active !== undefined) q = q.where('t.active', '=', Number(filter.active));
      if (filter.name) q = q.where(containsName(backend, 't.name_key', filter.name));
      if (filter.ids) {
        if (!filter.ids.length) return [];
        q = q.where('t.id', 'in', [...new Set(filter.ids)]);
      }
      return (await q.orderBy('t.name_key').orderBy('t.id').execute()).map(taskSummary);
    },
    async listSortKeys(wid, filter) {
      const q = db
        .selectFrom('tasks as t')
        .select(['t.id', 't.name', 't.created_at'])
        .where(searchScope(backend, wid, filter));
      return (await q.orderBy('t.id').execute()).map(r => ({
        id: entityId(r.id),
        name: r.name,
        createdAt: utcInstant(r.created_at),
      }));
    },
    async count(wid, filter) {
      const row = await db
        .selectFrom('tasks as t')
        .select(eb => eb.fn.countAll().as('n'))
        .where(searchScope(backend, wid, filter))
        .executeTakeFirstOrThrow();
      return safeInteger(row.n);
    },
    async listByCreation(wid, filter, order, range) {
      const direction = order === 'ASC' ? 'asc' : 'desc';
      // Stored instants share one fixed-width form, so their byte order is their time order.
      const q = catalogTaskQuery(db, backend)
        .where(searchScope(backend, wid, filter))
        .orderBy('t.created_at', direction)
        .orderBy('t.id', direction)
        .limit(range.limit)
        .offset(range.offset);
      return (await q.execute()).map(taskSummary);
    },
    async listForMember(userId, filter, range) {
      let q = catalogTaskQuery(db, backend)
        .innerJoin('workspace_users as wu', 'wu.workspace_id', 't.workspace_id')
        .where('wu.user_id', '=', userId);
      if (filter.active !== undefined) q = q.where('t.active', '=', Number(filter.active));
      if (filter.changedSince) q = q.where('t.updated_at', '>=', filter.changedSince);
      q = q.orderBy('t.workspace_id').orderBy('t.name_key').orderBy('t.id');
      // Paging in SQL computes tracked totals for this page's tasks only.
      if (range) q = q.limit(range.limit).offset(range.offset);
      return (await q.execute()).map(taskSummary);
    },
    async get(wid, id, pid) {
      let q = catalogTaskQuery(db, backend).where('t.workspace_id', '=', wid).where('t.id', '=', id);
      if (pid !== undefined) q = q.where('t.project_id', '=', pid);
      const r = await q.executeTakeFirst();
      return r && taskSummary(r);
    },
    async getRef(wid, id) {
      const r = await catalogTaskRefQuery(db, wid, id).executeTakeFirst();
      return (
        r && {
          id: entityId(r.id),
          workspaceId: entityId(r.workspace_id),
          projectId: entityId(r.project_id),
          active: booleanValue(r.active),
        }
      );
    },
    async findByName(wid, pid, name) {
      const r = await db
        .selectFrom('tasks')
        .select(['id', 'workspace_id', 'project_id', 'name', 'active', 'created_at', 'updated_at'])
        .select(taskEstimate(backend, 'estimated_seconds').as('estimated_seconds'))
        .where('workspace_id', '=', wid)
        .where('project_id', '=', pid)
        .where('name_key', '=', nameKey(backend, name))
        .executeTakeFirst();
      return r && task(r);
    },
    async create(input: TaskInput) {
      return catalogWrite(async () => {
        if (!(await projects.getRef(input.workspaceId, input.projectId))) throw new StorageConflict('foreign-key');
        const at = now();
        const id = await insertId(db, backend, 'tasks', {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          name: input.name,
          active: Number(input.active),
          estimated_seconds: input.estimatedSeconds,
          created_at: at,
          updated_at: at,
        });
        return required(await tasks.get(input.workspaceId, id));
      });
    },
    async update(wid, pid, id, changes) {
      return catalogWrite(async () => {
        await db
          .updateTable('tasks')
          .set({
            name: changes.name,
            active: changes.active === undefined ? undefined : Number(changes.active),
            estimated_seconds: changes.estimatedSeconds,
            updated_at: now(),
          })
          .where('workspace_id', '=', wid)
          .where('project_id', '=', pid)
          .where('id', '=', id)
          .execute();
        return required(await tasks.get(wid, id, pid));
      });
    },
    async delete(wid, pid, id) {
      if ((await tasks.getRef(wid, id))?.projectId !== pid) return;
      await db.updateTable('time_entries').set({ updated_at: now() }).where('task_id', '=', id).execute();
      await db
        .deleteFrom('tasks')
        .where('workspace_id', '=', wid)
        .where('project_id', '=', pid)
        .where('id', '=', id)
        .execute();
    },
  };
  return tasks;
}
