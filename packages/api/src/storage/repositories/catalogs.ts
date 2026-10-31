import { type Kysely, type Selectable, type Insertable } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase, ClientsRow, ProjectsRow, TasksRow, TagsRow } from '../physical.ts';
import type { Repositories, ProjectInput, TaskInput } from '../contracts.ts';
import type { Client, Project, Task, Tag, ProjectSummary, TaskSummary } from '../domain.ts';
import { booleanValue, entityId, finiteNumber, safeInteger, utcInstant } from '../conversion.ts';
import { StorageConflict } from '../errors.ts';
import { detachedProjectName } from '../../domain/catalog-names.ts';
import { catalogTotal, catalogWrite, containsName, nameKey, taskEstimate } from './catalog-sql.ts';

const nullable = <T>(value: T | null, convert: (v: T) => number): number | null => value === null ? null : convert(value);
const times = (r: { created_at: string; updated_at: string }) => ({ createdAt: utcInstant(r.created_at), updatedAt: utcInstant(r.updated_at) });
function client(r: Selectable<ClientsRow>): Client {
  return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), name: r.name, notes: r.notes, archived: booleanValue(r.archived), ...times(r) };
}
function project(r: Selectable<ProjectsRow>): Project {
  return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), clientId: nullable(r.client_id, entityId), name: r.name,
    color: r.color, active: booleanValue(r.active), isPrivate: booleanValue(r.is_private), billable: booleanValue(r.billable),
    estimatedHours: nullable(r.estimated_hours, finiteNumber), rate: nullable(r.rate, finiteNumber), currency: r.currency,
    fixedFee: nullable(r.fixed_fee, finiteNumber), startDate: r.start_date, endDate: r.end_date, template: booleanValue(r.template), ...times(r) };
}
function task(r: Omit<Selectable<TasksRow>, 'name_key'>): Task {
  return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), projectId: entityId(r.project_id), name: r.name,
    active: booleanValue(r.active), estimatedSeconds: nullable(r.estimated_seconds, finiteNumber), ...times(r) };
}
function tag(r: Selectable<TagsRow>): Tag { return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), name: r.name, ...times(r) }; }
const now = () => new Date().toISOString();
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Catalog record not found');
  return value;
}
export function catalogProjectQuery(db: Kysely<PhysicalDatabase>, backend: Backend) {
  return db.selectFrom('projects as p').leftJoin('clients as c', 'c.id', 'p.client_id').selectAll('p')
    .select(['c.name as client_name', catalogTotal(backend, 'project', now()).as('actual_seconds')]);
}
export function catalogTaskQuery(db: Kysely<PhysicalDatabase>, backend: Backend) {
  return db.selectFrom('tasks as t').innerJoin('projects as p', 'p.id', 't.project_id').leftJoin('clients as c', 'c.id', 'p.client_id')
    .select(['t.id', 't.workspace_id', 't.project_id', 't.name', 't.active', 't.created_at', 't.updated_at'])
    .select(taskEstimate(backend, 't.estimated_seconds').as('estimated_seconds')).select(['p.name as project_name', 'p.color as project_color', 'p.billable as project_billable',
      'p.is_private as project_is_private', 'p.client_id', 'c.name as client_name', catalogTotal(backend, 'task', now()).as('tracked_seconds')]);
}
export function catalogProjectRefQuery(db: Kysely<PhysicalDatabase>, wid: number, id: number) {
  return db.selectFrom('projects').select(['id', 'workspace_id', 'active', 'billable']).where('workspace_id', '=', wid).where('id', '=', id);
}
export function catalogTaskRefQuery(db: Kysely<PhysicalDatabase>, wid: number, id: number) {
  return db.selectFrom('tasks').select(['id', 'workspace_id', 'project_id', 'active']).where('workspace_id', '=', wid).where('id', '=', id);
}
function projectSummary(r: Awaited<ReturnType<ReturnType<typeof catalogProjectQuery>['execute']>>[number]): ProjectSummary {
  return { ...project(r), clientName: r.client_name, actualSeconds: safeInteger(r.actual_seconds) };
}
function taskSummary(r: Awaited<ReturnType<ReturnType<typeof catalogTaskQuery>['execute']>>[number]): TaskSummary {
  return { ...task(r), projectName: r.project_name, projectColor: r.project_color, projectBillable: booleanValue(r.project_billable),
    projectIsPrivate: booleanValue(r.project_is_private), clientId: nullable(r.client_id, entityId), clientName: r.client_name,
    trackedMilliseconds: safeInteger(safeInteger(r.tracked_seconds) * 1000) };
}
function projectValues(input: Partial<ProjectInput>) {
  return { client_id: input.clientId, name: input.name, color: input.color, active: input.active === undefined ? undefined : Number(input.active),
    is_private: input.isPrivate === undefined ? undefined : Number(input.isPrivate), billable: input.billable === undefined ? undefined : Number(input.billable),
    estimated_hours: input.estimatedHours, rate: input.rate, currency: input.currency, fixed_fee: input.fixedFee,
    start_date: input.startDate, end_date: input.endDate, template: input.template === undefined ? undefined : Number(input.template) };
}
/** Construct only with the transaction runner's bound handle. No connection or pool is captured. */
export function createCatalogRepositories(db: Kysely<PhysicalDatabase>, backend: Backend): Pick<Repositories, 'clients' | 'projects' | 'tasks' | 'tags'> {
  async function insertId(table: 'clients' | 'projects' | 'tasks' | 'tags', values: Insertable<ClientsRow> | Insertable<ProjectsRow> | Insertable<TasksRow> | Insertable<TagsRow>): Promise<number> {
    const query = db.insertInto(table).values(values);
    if (backend === 'sqlite' || backend === 'postgres') return entityId((await query.returning('id').executeTakeFirstOrThrow()).id);
    return entityId((await query.executeTakeFirstOrThrow()).insertId);
  }
  const clients: Repositories['clients'] = {
    async list(wid, filter = {}) {
      let q = db.selectFrom('clients').selectAll().where('workspace_id', '=', wid);
      if (filter.status === 'active' || filter.status === 'archived') q = q.where('archived', '=', Number(filter.status === 'archived'));
      if (filter.name) q = q.where(containsName(backend, 'name_key', filter.name));
      return (await q.orderBy('name_key').orderBy('id').execute()).map(client);
    },
    async get(wid, id) { const r = await db.selectFrom('clients').selectAll().where('workspace_id', '=', wid).where('id', '=', id).executeTakeFirst(); return r && client(r); },
    async findByName(wid, name) { const r = await db.selectFrom('clients').selectAll().where('workspace_id', '=', wid).where('name_key', '=', nameKey(backend, name)).executeTakeFirst(); return r && client(r); },
    async create(input) { return catalogWrite(async () => {
      const at = now(); const id = await insertId('clients', { workspace_id: input.workspaceId, name: input.name, notes: input.notes, archived: Number(input.archived), created_at: at, updated_at: at });
      return required(await clients.get(input.workspaceId, id));
    }); },
    async update(wid, id, changes) { return catalogWrite(async () => {
      await db.updateTable('clients').set({ name: changes.name, notes: changes.notes, archived: changes.archived === undefined ? undefined : Number(changes.archived), updated_at: now() }).where('workspace_id', '=', wid).where('id', '=', id).execute();
      return required(await clients.get(wid, id));
    }); },
    async setArchived(wid, id, archived) {
      const at = now();
      const changed = await db.selectFrom('projects').select('id').where('workspace_id', '=', wid).where('client_id', '=', id).where('active', '=', Number(archived)).orderBy('id').execute();
      await db.updateTable('clients').set({ archived: Number(archived), updated_at: at }).where('workspace_id', '=', wid).where('id', '=', id).execute();
      await db.updateTable('projects').set({ active: Number(!archived), updated_at: at }).where('workspace_id', '=', wid).where('client_id', '=', id).execute();
      return changed.map(r => entityId(r.id));
    },
    async restore(wid, id, ids, all) {
      const at = now();
      await clients.update(wid, id, { archived: false });
      if (all || ids.length) {
        let q = db.updateTable('projects').set({ active: 1, updated_at: at }).where('workspace_id', '=', wid).where('client_id', '=', id);
        if (!all) q = q.where('id', 'in', ids);
        await q.execute();
      }
      return required(await clients.get(wid, id));
    },
    async deleteAndDetachProjects(wid, id) {
      const c = await clients.get(wid, id); if (!c) return;
      const rows = await db.selectFrom('projects').select(['id', 'name']).where('workspace_id', '=', wid).where('client_id', '=', id).orderBy('id').execute();
      const colliding = new Set<number>();
      for (const p of rows) if (await projects.findByName(wid, null, p.name)) colliding.add(entityId(p.id));
      const detach = async (p: typeof rows[number], name: string) => { await db.updateTable('projects').set({ client_id: null, name, updated_at: now() }).where('workspace_id', '=', wid).where('id', '=', entityId(p.id)).execute(); };
      for (const p of rows) if (!colliding.has(entityId(p.id))) await detach(p, p.name);
      for (const p of rows) if (colliding.has(entityId(p.id))) {
        let attempt = 1; let name = detachedProjectName(p.name, c.name, attempt);
        while (await projects.findByName(wid, null, name)) name = detachedProjectName(p.name, c.name, ++attempt);
        await detach(p, name);
      }
      await db.deleteFrom('clients').where('workspace_id', '=', wid).where('id', '=', id).execute();
    },
  };
  const projects: Repositories['projects'] = {
    async getMetadata(wid, id) { const r = await db.selectFrom('projects').selectAll().where('workspace_id', '=', wid).where('id', '=', id).executeTakeFirst(); return r && project(r); },
    async listForClient(wid, cid) { return (await db.selectFrom('projects').select(['id', 'name']).where('workspace_id', '=', wid).where('client_id', '=', cid).execute()).map(r => ({ id: entityId(r.id), name: r.name })); },
    async count(wid) { return safeInteger((await db.selectFrom('projects').select(eb => eb.fn.countAll().as('n')).where('workspace_id', '=', wid).executeTakeFirstOrThrow()).n); },
    async list(wid, filter = {}) {
      let q = catalogProjectQuery(db, backend).where('p.workspace_id', '=', wid);
      if (typeof filter.active === 'boolean') q = q.where('p.active', '=', Number(filter.active));
      if (filter.billable !== undefined) q = q.where('p.billable', '=', Number(filter.billable));
      if (filter.name) q = q.where(containsName(backend, 'p.name_key', filter.name));
      if (filter.clientIds?.length) q = q.where('p.client_id', 'in', filter.clientIds);
      if (filter.changedSince) q = q.where('p.updated_at', '>=', filter.changedSince);
      return (await q.orderBy('p.name_key').orderBy('p.id').execute()).map(projectSummary);
    },
    async get(wid, id) { const r = await catalogProjectQuery(db, backend).where('p.workspace_id', '=', wid).where('p.id', '=', id).executeTakeFirst(); return r && projectSummary(r); },
    async getRef(wid, id) { const r = await catalogProjectRefQuery(db, wid, id).executeTakeFirst(); return r && { id: entityId(r.id), workspaceId: entityId(r.workspace_id), active: booleanValue(r.active), billable: booleanValue(r.billable) }; },
    async findByName(wid, cid, name) {
      const r = await db.selectFrom('projects').selectAll().where('workspace_id', '=', wid).where('client_scope', '=', cid ?? 0).where('name_key', '=', nameKey(backend, name)).executeTakeFirst(); return r && project(r);
    },
    async create(input) { return catalogWrite(async () => {
      if (input.clientId !== null && !await clients.get(input.workspaceId, input.clientId)) throw new StorageConflict('foreign-key');
      const at = now(); const id = await insertId('projects', { ...projectValues(input), workspace_id: input.workspaceId, name: input.name, color: input.color, client_id: input.clientId,
        estimated_hours: input.estimatedHours, rate: input.rate, currency: input.currency, fixed_fee: input.fixedFee, start_date: input.startDate, end_date: input.endDate, created_at: at, updated_at: at });
      return required(await projects.get(input.workspaceId, id));
    }); },
    async update(wid, id, changes) { return catalogWrite(async () => {
      if (changes.clientId != null && !await clients.get(wid, changes.clientId)) throw new StorageConflict('foreign-key');
      await db.updateTable('projects').set({ ...projectValues(changes), updated_at: now() }).where('workspace_id', '=', wid).where('id', '=', id).execute();
      return required(await projects.get(wid, id));
    }); },
    async delete(wid, id, mode) {
      // Explicit task cleanup also updates entries that reference a task without the project.
      const taskIds = db.selectFrom('tasks').select('id').where('workspace_id', '=', wid).where('project_id', '=', id);
      await db.updateTable('time_entries').set({ updated_at: now() }).where('task_id', 'in', taskIds).execute();
      await db.deleteFrom('tasks').where('workspace_id', '=', wid).where('project_id', '=', id).execute();
      let q = db.updateTable('time_entries').set(mode === 'delete' ? { deleted_at: now(), updated_at: now() } : { updated_at: now() }).where('workspace_id', '=', wid).where('project_id', '=', id);
      if (mode === 'delete') q = q.where('deleted_at', 'is', null);
      await q.execute();
      await db.deleteFrom('projects').where('workspace_id', '=', wid).where('id', '=', id).execute();
    },
  };
  const tasks: Repositories['tasks'] = {
    async getMetadata(wid, id) { const r = await db.selectFrom('tasks').select(['id', 'workspace_id', 'project_id', 'name', 'active', 'created_at', 'updated_at']).select(taskEstimate(backend, 'estimated_seconds').as('estimated_seconds')).where('workspace_id', '=', wid).where('id', '=', id).executeTakeFirst(); return r && task(r); },
    async list(wid, filter = {}) {
      let q = catalogTaskQuery(db, backend).where('t.workspace_id', '=', wid);
      if (filter.projectId !== undefined) q = q.where('t.project_id', '=', filter.projectId);
      if (filter.active !== undefined) q = q.where('t.active', '=', Number(filter.active));
      if (filter.name) q = q.where(containsName(backend, 't.name_key', filter.name));
      return (await q.orderBy('t.name_key').orderBy('t.id').execute()).map(taskSummary);
    },
    async get(wid, id, pid) {
      let q = catalogTaskQuery(db, backend).where('t.workspace_id', '=', wid).where('t.id', '=', id);
      if (pid !== undefined) q = q.where('t.project_id', '=', pid);
      const r = await q.executeTakeFirst(); return r && taskSummary(r);
    },
    async getRef(wid, id) { const r = await catalogTaskRefQuery(db, wid, id).executeTakeFirst(); return r && { id: entityId(r.id), workspaceId: entityId(r.workspace_id), projectId: entityId(r.project_id), active: booleanValue(r.active) }; },
    async findByName(wid, pid, name) { const r = await db.selectFrom('tasks').select(['id', 'workspace_id', 'project_id', 'name', 'active', 'created_at', 'updated_at']).select(taskEstimate(backend, 'estimated_seconds').as('estimated_seconds')).where('workspace_id', '=', wid).where('project_id', '=', pid).where('name_key', '=', nameKey(backend, name)).executeTakeFirst(); return r && task(r); },
    async create(input: TaskInput) { return catalogWrite(async () => {
      if (!await projects.getRef(input.workspaceId, input.projectId)) throw new StorageConflict('foreign-key');
      const at = now(); const id = await insertId('tasks', { workspace_id: input.workspaceId, project_id: input.projectId, name: input.name, active: Number(input.active), estimated_seconds: input.estimatedSeconds, created_at: at, updated_at: at });
      return required(await tasks.get(input.workspaceId, id));
    }); },
    async update(wid, pid, id, changes) { return catalogWrite(async () => {
      await db.updateTable('tasks').set({ name: changes.name, active: changes.active === undefined ? undefined : Number(changes.active), estimated_seconds: changes.estimatedSeconds, updated_at: now() }).where('workspace_id', '=', wid).where('project_id', '=', pid).where('id', '=', id).execute();
      return required(await tasks.get(wid, id, pid));
    }); },
    async delete(wid, pid, id) {
      if ((await tasks.getRef(wid, id))?.projectId !== pid) return;
      await db.updateTable('time_entries').set({ updated_at: now() }).where('task_id', '=', id).execute();
      await db.deleteFrom('tasks').where('workspace_id', '=', wid).where('project_id', '=', pid).where('id', '=', id).execute();
    },
  };
  const tags: Repositories['tags'] = {
    async findByIds(wid, ids) {
      if (!ids.length) return [];
      return (await db.selectFrom('tags').selectAll().where('workspace_id', '=', wid).where('id', 'in', [...new Set(ids)]).orderBy('name_key').orderBy('id').execute()).map(tag);
    },
    async list(wid, search) {
      let q = db.selectFrom('tags').selectAll().where('workspace_id', '=', wid);
      if (search) q = q.where(containsName(backend, 'name_key', search));
      return (await q.orderBy('name_key').orderBy('id').execute()).map(tag);
    },
    async get(wid, id) { const r = await db.selectFrom('tags').selectAll().where('workspace_id', '=', wid).where('id', '=', id).executeTakeFirst(); return r && tag(r); },
    async findByName(wid, name) { const r = await db.selectFrom('tags').selectAll().where('workspace_id', '=', wid).where('name_key', '=', nameKey(backend, name)).executeTakeFirst(); return r && tag(r); },
    async resolveNames(wid, names) {
      const result: Tag[] = [];
      for (const name of names) result.push(await tags.findByName(wid, name) ?? await tags.create(wid, name));
      return result;
    },
    async create(wid, name) { return catalogWrite(async () => { const at = now(); const id = await insertId('tags', { workspace_id: wid, name, created_at: at, updated_at: at }); return required(await tags.get(wid, id)); }); },
    async rename(wid, id, name) { return catalogWrite(async () => { await db.updateTable('tags').set({ name, updated_at: now() }).where('workspace_id', '=', wid).where('id', '=', id).execute(); return required(await tags.get(wid, id)); }); },
    async delete(wid, id) {
      if (!await tags.get(wid, id)) return;
      const ids = db.selectFrom('time_entry_tags').select('time_entry_id').where('tag_id', '=', id);
      await db.updateTable('time_entries').set({ updated_at: now() }).where('id', 'in', ids).execute();
      await db.deleteFrom('tags').where('workspace_id', '=', wid).where('id', '=', id).execute();
    },
  };
  return { clients, projects, tasks, tags };
}
