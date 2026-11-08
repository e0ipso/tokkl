/** Tags of a workspace; names are unique by their case-folded key. */
import { type Kysely } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase } from '../physical.ts';
import type { Repositories } from '../../domain/ports.ts';
import type { Tag } from '../../domain/model.ts';
import { catalogWrite, containsName, nameKey } from './catalog-sql.ts';
import { insertId, now, required, tag } from './catalog-queries.ts';

export function createTagRepository(db: Kysely<PhysicalDatabase>, backend: Backend): Repositories['tags'] {
  const tags: Repositories['tags'] = {
    async findByIds(wid, ids) {
      if (!ids.length) return [];
      return (
        await db
          .selectFrom('tags')
          .selectAll()
          .where('workspace_id', '=', wid)
          .where('id', 'in', [...new Set(ids)])
          .orderBy('name_key')
          .orderBy('id')
          .execute()
      ).map(tag);
    },
    async list(wid, search, range) {
      let q = db.selectFrom('tags').selectAll().where('workspace_id', '=', wid);
      if (search) q = q.where(containsName(backend, 'name_key', search));
      q = q.orderBy('name_key').orderBy('id');
      if (range) q = q.limit(range.limit).offset(range.offset);
      return (await q.execute()).map(tag);
    },
    async get(wid, id) {
      const r = await db
        .selectFrom('tags')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('id', '=', id)
        .executeTakeFirst();
      return r && tag(r);
    },
    async findByName(wid, name) {
      const r = await db
        .selectFrom('tags')
        .selectAll()
        .where('workspace_id', '=', wid)
        .where('name_key', '=', nameKey(backend, name))
        .executeTakeFirst();
      return r && tag(r);
    },
    async resolveNames(wid, names) {
      const result: Tag[] = [];
      for (const name of names) result.push((await tags.findByName(wid, name)) ?? (await tags.create(wid, name)));
      return result;
    },
    async create(wid, name) {
      return catalogWrite(async () => {
        const at = now();
        const id = await insertId(db, backend, 'tags', { workspace_id: wid, name, created_at: at, updated_at: at });
        return required(await tags.get(wid, id));
      });
    },
    async rename(wid, id, name) {
      return catalogWrite(async () => {
        await db
          .updateTable('tags')
          .set({ name, updated_at: now() })
          .where('workspace_id', '=', wid)
          .where('id', '=', id)
          .execute();
        return required(await tags.get(wid, id));
      });
    },
    async delete(wid, id) {
      if (!(await tags.get(wid, id))) return;
      const ids = db.selectFrom('time_entry_tags').select('time_entry_id').where('tag_id', '=', id);
      await db.updateTable('time_entries').set({ updated_at: now() }).where('id', 'in', ids).execute();
      await db.deleteFrom('tags').where('workspace_id', '=', wid).where('id', '=', id).execute();
    },
  };
  return tags;
}
