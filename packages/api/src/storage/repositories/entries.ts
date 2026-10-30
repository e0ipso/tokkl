import type { Kysely, Selectable, Updateable } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase, TimeEntriesRow } from '../physical.ts';
import type { EntryFilter, EntryInput, Repositories } from '../contracts.ts';
import type { EntryDetails, TimeEntry, TagLabel } from '../domain.ts';
import { booleanValue, entityId, safeInteger, utcInstant } from '../conversion.ts';
import { classifyConflict } from '../errors.ts';

const nullableId = (v: number | string | null) => v === null ? null : entityId(v);
const instant = (v: string | null) => v === null ? null : utcInstant(v);
export function entryValue(r: Selectable<TimeEntriesRow>): TimeEntry {
  return { id: entityId(r.id), userId: entityId(r.user_id), workspaceId: entityId(r.workspace_id),
    projectId: nullableId(r.project_id), taskId: nullableId(r.task_id), description: r.description,
    start: utcInstant(r.start), stop: instant(r.stop), billable: booleanValue(r.billable), durationOnly: booleanValue(r.duronly),
    allDay: booleanValue(r.all_day), createdWith: r.created_with, createdAt: utcInstant(r.created_at),
    updatedAt: utcInstant(r.updated_at), deletedAt: instant(r.deleted_at) };
}
function values(input: Partial<EntryInput>): Updateable<TimeEntriesRow> {
  return { project_id: input.projectId, task_id: input.taskId, description: input.description, start: input.start,
    stop: input.stop, billable: input.billable === undefined ? undefined : Number(input.billable),
    duronly: input.durationOnly === undefined ? undefined : Number(input.durationOnly),
    all_day: input.allDay === undefined ? undefined : Number(input.allDay), created_with: input.createdWith, deleted_at: input.deletedAt };
}
export function entryDetailsQuery(db: Kysely<PhysicalDatabase>) {
  return db.selectFrom('time_entries as e').leftJoin('projects as p', 'p.id', 'e.project_id')
    .leftJoin('clients as c', 'c.id', 'p.client_id').leftJoin('tasks as t', 't.id', 'e.task_id').selectAll('e')
    .select(['p.name as project_name', 'p.color as project_color', 'p.active as project_active', 'p.billable as project_billable',
      'c.id as client_id', 'c.name as client_name', 't.name as task_name', 't.active as task_active']);
}
/** Labels are fetched for the complete result in bounded batches, never once per entry. */
async function details(db: Kysely<PhysicalDatabase>, rows: Awaited<ReturnType<ReturnType<typeof entryDetailsQuery>['execute']>>): Promise<EntryDetails[]> {
  const tags = new Map<number, TagLabel[]>();
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = rows.slice(offset, offset + 400).map(r => entityId(r.id));
    const labels = await db.selectFrom('time_entry_tags as et').innerJoin('tags as g', 'g.id', 'et.tag_id')
      .select(['et.time_entry_id', 'g.id', 'g.name']).where('et.time_entry_id', 'in', batch).orderBy('g.name_key').orderBy('g.id').execute();
    for (const label of labels) {
      const id = entityId(label.time_entry_id), list = tags.get(id) ?? [];
      list.push({ id: entityId(label.id), name: label.name }); tags.set(id, list);
    }
  }
  return rows.map(r => ({ ...entryValue(r), tags: tags.get(entityId(r.id)) ?? [],
    project: r.project_name === null ? null : { name: r.project_name, color: r.project_color!, active: booleanValue(r.project_active), billable: booleanValue(r.project_billable) },
    client: r.client_id === null ? null : { id: entityId(r.client_id), name: r.client_name! },
    task: r.task_name === null ? null : { name: r.task_name, active: booleanValue(r.task_active) } }));
}
async function write<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw classifyConflict(error) ?? error; }
}
export function createEntryRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): Pick<Repositories, 'entries'> {
  const entries: Repositories['entries'] = {
    async list(userId, filter: EntryFilter = {}) {
      let q = entryDetailsQuery(db).where('e.user_id', '=', userId);
      q = filter.changedSince ? q.where('e.updated_at', '>=', filter.changedSince) : q.where('e.deleted_at', 'is', null);
      if (filter.from) q = q.where('e.start', '>=', filter.from);
      if (filter.to) q = q.where('e.start', '<', filter.to);
      if (filter.projectIds) {
        const ids = filter.projectIds.filter((id): id is number => id !== null);
        q = q.where(eb => eb.or([...(ids.length ? [eb('e.project_id', 'in', ids)] : []),
          ...(filter.projectIds!.includes(null) ? [eb('e.project_id', 'is', null)] : [])]));
      }
      if (filter.limit) q = q.limit(Math.floor(filter.limit));
      return details(db, await q.orderBy('e.start', 'desc').orderBy('e.id', 'desc').execute());
    },
    async get(userId, id, includeDeleted = false) {
      let q = entryDetailsQuery(db).where('e.user_id', '=', userId).where('e.id', '=', id);
      if (!includeDeleted) q = q.where('e.deleted_at', 'is', null);
      return (await details(db, await q.execute()))[0];
    },
    async running(userId) { return (await details(db, await entryDetailsQuery(db).where('e.user_id', '=', userId).where('e.stop', 'is', null).where('e.deleted_at', 'is', null).execute()))[0]; },
    async bounds(userId) {
      const r = await db.selectFrom('time_entries').select(eb => [eb.fn.min('start').as('first'), eb.fn.max('start').as('last')]).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
      return { firstStart: r.first == null ? null : utcInstant(r.first), lastStart: r.last == null ? null : utcInstant(r.last) };
    },
    async create(input) { return write(async () => {
      const at = new Date().toISOString();
      const q = db.insertInto('time_entries').values({ workspace_id: input.workspaceId, user_id: input.userId,
        project_id: input.projectId, task_id: input.taskId, description: input.description, start: input.start, stop: input.stop,
        billable: Number(input.billable), duronly: Number(input.durationOnly), all_day: Number(input.allDay),
        created_with: input.createdWith, deleted_at: input.deletedAt, created_at: at, updated_at: at });
      const id = backend === 'sqlite' || backend === 'postgres' ? entityId((await q.returning('id').executeTakeFirstOrThrow()).id) : entityId((await q.executeTakeFirstOrThrow()).insertId);
      await entries.setTags(input.userId, id, input.tagIds);
      return (await entries.get(input.userId, id, true))!;
    }); },
    async update(userId, wid, id, changes) { return write(async () => {
      await db.updateTable('time_entries').set({ ...values(changes), updated_at: new Date().toISOString() }).where('user_id', '=', userId).where('workspace_id', '=', wid).where('id', '=', id).execute();
      if (changes.tagIds !== undefined) await entries.setTags(userId, id, changes.tagIds);
      const result = await entries.get(userId, id, true);
      if (!result || result.workspaceId !== wid) throw new Error('Entry record not found');
      return result;
    }); },
    async setTags(userId, id, tagIds) {
      const entry = await db.selectFrom('time_entries').select('workspace_id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
      if (!entry) throw new Error('Entry record not found');
      const ids = [...new Set(tagIds)];
      if (ids.length) {
        const tags = await db.selectFrom('tags').select('id').where('workspace_id', '=', entityId(entry.workspace_id)).where('id', 'in', ids).execute();
        if (tags.length !== ids.length) throw new Error('Entry tag not found');
      }
      await db.deleteFrom('time_entry_tags').where('time_entry_id', '=', id).execute();
      for (let i = 0; i < ids.length; i += 400) await db.insertInto('time_entry_tags').values(ids.slice(i, i + 400).map(tag_id => ({ time_entry_id: id, tag_id }))).execute();
    },
    async softDelete(userId, wid, id, at) { await db.updateTable('time_entries').set({ deleted_at: at, updated_at: at }).where('user_id', '=', userId).where('workspace_id', '=', wid).where('id', '=', id).execute(); },
    async restore(userId, id) {
      await db.updateTable('time_entries').set({ deleted_at: null, updated_at: new Date().toISOString() }).where('user_id', '=', userId).where('id', '=', id).execute();
      return (await entries.get(userId, id))!;
    },
    async listDeleted(userId) { return details(db, await entryDetailsQuery(db).where('e.user_id', '=', userId).where('e.deleted_at', 'is not', null).orderBy('e.deleted_at', 'desc').limit(1000).execute()); },
    async purgeDeleted(userId, id) {
      let q = db.deleteFrom('time_entries').where('user_id', '=', userId).where('deleted_at', 'is not', null);
      if (id !== undefined) q = q.where('id', '=', id);
      return safeInteger((await q.executeTakeFirstOrThrow()).numDeletedRows);
    },
    async listAllDay(userId) { return (await db.selectFrom('time_entries').selectAll().where('user_id', '=', userId).where('all_day', '=', 1).execute()).map(entryValue); },
    async findDuplicate(key) {
      let q = db.selectFrom('time_entries').select('id').where('user_id', '=', key.userId).where('start', '=', key.start).where('description', '=', key.description).where('deleted_at', 'is', null);
      q = key.stop === null ? q.where('stop', 'is', null) : q.where('stop', '=', key.stop);
      q = key.projectId === null ? q.where('project_id', 'is', null) : q.where('project_id', '=', key.projectId);
      const row = await q.executeTakeFirst(); return row && entityId(row.id);
    },
  };
  return { entries };
}
