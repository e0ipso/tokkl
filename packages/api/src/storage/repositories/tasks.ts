/** Tasks of a project, with their project and client names and tracked total. */
import { type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories, TaskInput } from '../contracts.ts';
import { booleanValue, entityId, utcInstant } from '../conversion.ts';
import { StorageConflict } from '../errors.ts';
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
      let q = db.selectFrom('tasks').select(['id', 'name', 'created_at', 'updated_at']).where('workspace_id', '=', wid);
      if (filter.projectId !== undefined) q = q.where('project_id', '=', filter.projectId);
      if (filter.active !== undefined) q = q.where('active', '=', Number(filter.active));
      return (await q.orderBy('id').execute()).map(r => ({
        id: entityId(r.id),
        name: r.name,
        createdAt: utcInstant(r.created_at),
        updatedAt: utcInstant(r.updated_at),
      }));
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
