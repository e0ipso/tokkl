import type { Selectable } from 'kysely';
import type { ClientsRow, ProjectsRow, TasksRow, TagsRow } from '../physical.ts';
import type { Client, Project, Task, Tag, ProjectSummary, TaskSummary } from '../domain.ts';
import { booleanValue, entityId, finiteNumber, safeInteger, utcInstant } from '../conversion.ts';
import { catalogProjectQuery, catalogTaskQuery } from './catalogs.ts';
const nullable = <T>(value: T | null, convert: (v: T) => number): number | null => value === null ? null : convert(value);
const times = (r: { created_at: string; updated_at: string }) => ({ createdAt: utcInstant(r.created_at), updatedAt: utcInstant(r.updated_at) });
export function client(r: Selectable<ClientsRow>): Client {
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
export function tag(r: Selectable<TagsRow>): Tag { return { id: entityId(r.id), workspaceId: entityId(r.workspace_id), name: r.name, ...times(r) }; }
export function projectSummary(r: Awaited<ReturnType<ReturnType<typeof catalogProjectQuery>['execute']>>[number]): ProjectSummary {
  return { ...project(r), clientName: r.client_name, actualSeconds: safeInteger(r.actual_seconds) };
}
export function taskSummary(r: Awaited<ReturnType<ReturnType<typeof catalogTaskQuery>['execute']>>[number]): TaskSummary {
  return { ...task(r), projectName: r.project_name, projectColor: r.project_color, projectBillable: booleanValue(r.project_billable),
    projectIsPrivate: booleanValue(r.project_is_private), clientId: nullable(r.client_id, entityId), clientName: r.client_name,
    trackedMilliseconds: safeInteger(safeInteger(r.tracked_seconds) * 1000) };
}
