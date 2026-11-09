/** Projects of a workspace, with their client name and tracked total. */
import { type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../../domain/ports.ts';
import { booleanValue, entityId, safeInteger } from '../conversion.ts';
import { StorageConflict } from '../../domain/ports.ts';
import { bumpCatalogRevision, catalogWrite, containsName, nameKey } from './catalog-sql.ts';
import {
  catalogProjectQuery,
  catalogProjectRefQuery,
  insertId,
  now,
  project,
  projectSummary,
  projectValues,
  required,
} from './catalog-queries.ts';

export function createProjectRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  clients: Pick<Repositories['clients'], 'get'>,
): Repositories['projects'] {
  const projects: Repositories['projects'] = {
    async getMetadata(wid, id) {
      const r = await db
        .selectFrom('projects')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('id', '=', id)
        .executeTakeFirst();
      return r && project(r);
    },
    async listForClient(wid, cid) {
      return (
        await db
          .selectFrom('projects')
          .select(['id', 'name'])
          .where('workspace_id', '=', wid)
          .where('client_id', '=', cid)
          .execute()
      ).map(r => ({ id: entityId(r.id), name: r.name }));
    },
    async count(wid) {
      return safeInteger(
        (
          await db
            .selectFrom('projects')
            .select(eb => eb.fn.countAll().as('n'))
            .where('workspace_id', '=', wid)
            .executeTakeFirstOrThrow()
        ).n,
      );
    },
    async list(wid, filter = {}, range) {
      let q = catalogProjectQuery(db, backend).where('p.workspace_id', '=', wid);
      if (typeof filter.active === 'boolean') q = q.where('p.active', '=', Number(filter.active));
      if (filter.billable !== undefined) q = q.where('p.billable', '=', Number(filter.billable));
      if (filter.name) q = q.where(containsName(backend, 'p.name_key', filter.name));
      if (filter.clientIds?.length) q = q.where('p.client_id', 'in', filter.clientIds);
      if (filter.changedSince) q = q.where('p.updated_at', '>=', filter.changedSince);
      q = q.orderBy('p.name_key').orderBy('p.id');
      // Paging in SQL computes tracked totals for this page's projects only.
      if (range) q = q.limit(range.limit).offset(range.offset);
      return (await q.execute()).map(projectSummary);
    },
    async get(wid, id) {
      const r = await catalogProjectQuery(db, backend)
        .where('p.workspace_id', '=', wid)
        .where('p.id', '=', id)
        .executeTakeFirst();
      return r && projectSummary(r);
    },
    async getRef(wid, id) {
      const r = await catalogProjectRefQuery(db, wid, id).executeTakeFirst();
      return (
        r && {
          id: entityId(r.id),
          workspaceId: entityId(r.workspace_id),
          active: booleanValue(r.active),
          billable: booleanValue(r.billable),
        }
      );
    },
    async findByName(wid, cid, name) {
      const r = await db
        .selectFrom('projects')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('client_scope', '=', cid ?? 0)
        .where('name_key', '=', nameKey(backend, name))
        .executeTakeFirst();
      return r && project(r);
    },
    async create(input) {
      return catalogWrite(async () => {
        if (input.clientId !== null && !(await clients.get(input.workspaceId, input.clientId)))
          throw new StorageConflict('foreign-key');
        const at = now();
        const id = await insertId(db, backend, 'projects', {
          ...projectValues(input),
          workspace_id: input.workspaceId,
          name: input.name,
          color: input.color,
          client_id: input.clientId,
          estimated_hours: input.estimatedHours,
          rate: input.rate,
          currency: input.currency,
          fixed_fee: input.fixedFee,
          start_date: input.startDate,
          end_date: input.endDate,
          created_at: at,
          updated_at: at,
        });
        await bumpCatalogRevision(db, input.workspaceId);
        return required(await projects.get(input.workspaceId, id));
      });
    },
    async update(wid, id, changes) {
      return catalogWrite(async () => {
        if (changes.clientId != null && !(await clients.get(wid, changes.clientId)))
          throw new StorageConflict('foreign-key');
        await db
          .updateTable('projects')
          .set({ ...projectValues(changes), updated_at: now() })
          .where('workspace_id', '=', wid)
          .where('id', '=', id)
          .execute();
        await bumpCatalogRevision(db, wid);
        return required(await projects.get(wid, id));
      });
    },
    async delete(wid, id, mode) {
      // Explicit task cleanup also updates entries that reference a task without the project.
      const taskIds = db.selectFrom('tasks').select('id').where('workspace_id', '=', wid).where('project_id', '=', id);
      await db.updateTable('time_entries').set({ updated_at: now() }).where('task_id', 'in', taskIds).execute();
      await db.deleteFrom('tasks').where('workspace_id', '=', wid).where('project_id', '=', id).execute();
      let q = db
        .updateTable('time_entries')
        .set(mode === 'delete' ? { deleted_at: now(), updated_at: now() } : { updated_at: now() })
        .where('workspace_id', '=', wid)
        .where('project_id', '=', id);
      if (mode === 'delete') q = q.where('deleted_at', 'is', null);
      await q.execute();
      await db.deleteFrom('projects').where('workspace_id', '=', wid).where('id', '=', id).execute();
      await bumpCatalogRevision(db, wid);
    },
  };
  return projects;
}
