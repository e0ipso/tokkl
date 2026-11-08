/** Clients of a workspace. Deleting one detaches its projects under unique names. */
import { type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../../domain/ports.ts';
import { entityId } from '../conversion.ts';
import { detachedProjectName } from './catalog-names.ts';
import { catalogWrite, containsName, nameKey } from './catalog-sql.ts';
import { client, insertId, now, required } from './catalog-queries.ts';

export function createClientRepository(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  projects: Pick<Repositories['projects'], 'findByName'>,
): Repositories['clients'] {
  const clients: Repositories['clients'] = {
    async list(wid, filter = {}) {
      let q = db.selectFrom('clients').selectAll().where('workspace_id', '=', wid);
      if (filter.status === 'active' || filter.status === 'archived')
        q = q.where('archived', '=', Number(filter.status === 'archived'));
      if (filter.name) q = q.where(containsName(backend, 'name_key', filter.name));
      return (await q.orderBy('name_key').orderBy('id').execute()).map(client);
    },
    async get(wid, id) {
      const r = await db
        .selectFrom('clients')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('id', '=', id)
        .executeTakeFirst();
      return r && client(r);
    },
    async findByName(wid, name) {
      const r = await db
        .selectFrom('clients')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('name_key', '=', nameKey(backend, name))
        .executeTakeFirst();
      return r && client(r);
    },
    async create(input) {
      return catalogWrite(async () => {
        const at = now();
        const id = await insertId(db, backend, 'clients', {
          workspace_id: input.workspaceId,
          name: input.name,
          notes: input.notes,
          archived: Number(input.archived),
          created_at: at,
          updated_at: at,
        });
        return required(await clients.get(input.workspaceId, id));
      });
    },
    async update(wid, id, changes) {
      return catalogWrite(async () => {
        await db
          .updateTable('clients')
          .set({
            name: changes.name,
            notes: changes.notes,
            archived: changes.archived === undefined ? undefined : Number(changes.archived),
            updated_at: now(),
          })
          .where('workspace_id', '=', wid)
          .where('id', '=', id)
          .execute();
        return required(await clients.get(wid, id));
      });
    },
    async setArchived(wid, id, archived) {
      const at = now();
      const changed = await db
        .selectFrom('projects')
        .select('id')
        .where('workspace_id', '=', wid)
        .where('client_id', '=', id)
        .where('active', '=', Number(archived))
        .orderBy('id')
        .execute();
      await db
        .updateTable('clients')
        .set({ archived: Number(archived), updated_at: at })
        .where('workspace_id', '=', wid)
        .where('id', '=', id)
        .execute();
      await db
        .updateTable('projects')
        .set({ active: Number(!archived), updated_at: at })
        .where('workspace_id', '=', wid)
        .where('client_id', '=', id)
        .execute();
      return changed.map(r => entityId(r.id));
    },
    async restore(wid, id, ids, all) {
      const at = now();
      await clients.update(wid, id, { archived: false });
      if (all || ids.length) {
        let q = db
          .updateTable('projects')
          .set({ active: 1, updated_at: at })
          .where('workspace_id', '=', wid)
          .where('client_id', '=', id);
        if (!all) q = q.where('id', 'in', ids);
        await q.execute();
      }
      return required(await clients.get(wid, id));
    },
    async deleteAndDetachProjects(wid, id) {
      const c = await clients.get(wid, id);
      if (!c) return;
      const rows = await db
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('workspace_id', '=', wid)
        .where('client_id', '=', id)
        .orderBy('id')
        .execute();
      const colliding = new Set<number>();
      for (const p of rows) if (await projects.findByName(wid, null, p.name)) colliding.add(entityId(p.id));
      const detach = async (p: (typeof rows)[number], name: string) => {
        await db
          .updateTable('projects')
          .set({ client_id: null, name, updated_at: now() })
          .where('workspace_id', '=', wid)
          .where('id', '=', entityId(p.id))
          .execute();
      };
      for (const p of rows) if (!colliding.has(entityId(p.id))) await detach(p, p.name);
      for (const p of rows)
        if (colliding.has(entityId(p.id))) {
          let attempt = 1;
          let name = detachedProjectName(p.name, c.name, attempt);
          while (await projects.findByName(wid, null, name)) name = detachedProjectName(p.name, c.name, ++attempt);
          await detach(p, name);
        }
      await db.deleteFrom('clients').where('workspace_id', '=', wid).where('id', '=', id).execute();
    },
  };
  return clients;
}
