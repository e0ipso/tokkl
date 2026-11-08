/** Row mappers and queries the catalog repositories and the transfer reads share. */
import { type Kysely, type Selectable, type Insertable } from 'kysely';
import type { Backend } from '../config.ts';
import type { PhysicalDatabase, ClientsRow, ProjectsRow, TasksRow, TagsRow } from '../physical.ts';
import type { ProjectInput } from '../../domain/ports.ts';
import type { Client, Project, Task, Tag, ProjectSummary, TaskSummary } from '../../domain/model.ts';
import { booleanValue, entityId, finiteNumber, safeInteger, utcInstant } from '../conversion.ts';
import { catalogTotal, taskEstimate } from './catalog-sql.ts';

const nullable = <T>(value: T | null, convert: (v: T) => number): number | null =>
  value === null ? null : convert(value);
const times = (r: { created_at: string; updated_at: string }) => ({
  createdAt: utcInstant(r.created_at),
  updatedAt: utcInstant(r.updated_at),
});
export function client(r: Selectable<ClientsRow>): Client {
  return {
    id: entityId(r.id),
    workspaceId: entityId(r.workspace_id),
    name: r.name,
    notes: r.notes,
    archived: booleanValue(r.archived),
    ...times(r),
  };
}
export function project(r: Selectable<ProjectsRow>): Project {
  return {
    id: entityId(r.id),
    workspaceId: entityId(r.workspace_id),
    clientId: nullable(r.client_id, entityId),
    name: r.name,
    color: r.color,
    active: booleanValue(r.active),
    isPrivate: booleanValue(r.is_private),
    billable: booleanValue(r.billable),
    estimatedHours: nullable(r.estimated_hours, finiteNumber),
    rate: nullable(r.rate, finiteNumber),
    currency: r.currency,
    fixedFee: nullable(r.fixed_fee, finiteNumber),
    startDate: r.start_date,
    endDate: r.end_date,
    template: booleanValue(r.template),
    ...times(r),
  };
}
export function task(r: Omit<Selectable<TasksRow>, 'name_key'>): Task {
  return {
    id: entityId(r.id),
    workspaceId: entityId(r.workspace_id),
    projectId: entityId(r.project_id),
    name: r.name,
    active: booleanValue(r.active),
    estimatedSeconds: nullable(r.estimated_seconds, finiteNumber),
    ...times(r),
  };
}
export function tag(r: Selectable<TagsRow>): Tag {
  return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), name: r.name, ...times(r) };
}
export const now = () => new Date().toISOString();
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Catalog record not found');
  return value;
}
export function catalogProjectQuery(db: Kysely<PhysicalDatabase>, backend: Backend) {
  return db
    .selectFrom('projects as p')
    .leftJoin('clients as c', 'c.id', 'p.client_id')
    .selectAll('p')
    .select(['c.name as client_name', catalogTotal(backend, 'project', now()).as('actual_seconds')]);
}
export function catalogTaskQuery(db: Kysely<PhysicalDatabase>, backend: Backend) {
  return db
    .selectFrom('tasks as t')
    .innerJoin('projects as p', 'p.id', 't.project_id')
    .leftJoin('clients as c', 'c.id', 'p.client_id')
    .select(['t.id', 't.workspace_id', 't.project_id', 't.name', 't.active', 't.created_at', 't.updated_at'])
    .select(taskEstimate(backend, 't.estimated_seconds').as('estimated_seconds'))
    .select([
      'p.name as project_name',
      'p.color as project_color',
      'p.billable as project_billable',
      'p.is_private as project_is_private',
      'p.client_id',
      'c.name as client_name',
      catalogTotal(backend, 'task', now()).as('tracked_seconds'),
    ]);
}
export function catalogProjectRefQuery(db: Kysely<PhysicalDatabase>, wid: number, id: number) {
  return db
    .selectFrom('projects')
    .select(['id', 'workspace_id', 'active', 'billable'])
    .where('workspace_id', '=', wid)
    .where('id', '=', id);
}
export function catalogTaskRefQuery(db: Kysely<PhysicalDatabase>, wid: number, id: number) {
  return db
    .selectFrom('tasks')
    .select(['id', 'workspace_id', 'project_id', 'active'])
    .where('workspace_id', '=', wid)
    .where('id', '=', id);
}
export function projectSummary(
  r: Awaited<ReturnType<ReturnType<typeof catalogProjectQuery>['execute']>>[number],
): ProjectSummary {
  return { ...project(r), clientName: r.client_name, actualSeconds: safeInteger(r.actual_seconds) };
}
export function taskSummary(
  r: Awaited<ReturnType<ReturnType<typeof catalogTaskQuery>['execute']>>[number],
): TaskSummary {
  return {
    ...task(r),
    projectName: r.project_name,
    projectColor: r.project_color,
    projectBillable: booleanValue(r.project_billable),
    projectIsPrivate: booleanValue(r.project_is_private),
    clientId: nullable(r.client_id, entityId),
    clientName: r.client_name,
    trackedMilliseconds: safeInteger(safeInteger(r.tracked_seconds) * 1000),
  };
}
export function projectValues(input: Partial<ProjectInput>) {
  return {
    client_id: input.clientId,
    name: input.name,
    color: input.color,
    active: input.active === undefined ? undefined : Number(input.active),
    is_private: input.isPrivate === undefined ? undefined : Number(input.isPrivate),
    billable: input.billable === undefined ? undefined : Number(input.billable),
    estimated_hours: input.estimatedHours,
    rate: input.rate,
    currency: input.currency,
    fixed_fee: input.fixedFee,
    start_date: input.startDate,
    end_date: input.endDate,
    template: input.template === undefined ? undefined : Number(input.template),
  };
}
/** Inserts one catalog row and returns its id, on every backend. */
export async function insertId(
  db: Kysely<PhysicalDatabase>,
  backend: Backend,
  table: 'clients' | 'projects' | 'tasks' | 'tags',
  values: Insertable<ClientsRow> | Insertable<ProjectsRow> | Insertable<TasksRow> | Insertable<TagsRow>,
): Promise<number> {
  const query = db.insertInto(table).values(values);
  if (backend === 'sqlite' || backend === 'postgres')
    return entityId((await query.returning('id').executeTakeFirstOrThrow()).id);
  return entityId((await query.executeTakeFirstOrThrow()).insertId);
}
