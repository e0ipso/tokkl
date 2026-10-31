import { PROJECT_COLORS, isHexColor } from '@tokkl/common/colors';
import type { OperationContext, Repositories, ProjectInput } from '../storage/contracts.ts';
import type { Client, Id, ProjectSummary, TaskSummary, Tag } from '../storage/domain.ts';
import { StorageConflict } from '../storage/errors.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { optionalBool, optionalId, optionalNumber, optionalRate, optionalString, requireName, togglTime } from '../lib/values.ts';

export type CatalogRepositories = Pick<Repositories, 'clients' | 'projects' | 'tasks' | 'tags'>;
export type CatalogContext = OperationContext<CatalogRepositories>;
type Body = Record<string, unknown>;
/** Required for metadata mutations. Prepare discovers/locks affected users before changes.
 * Keep the original baseline on repeated preparation in the same context. Settlement uses
 * that context; publication runs only after commit and release. Tag cleanup joins it too. */
export interface CatalogTimerEffects {
  prepare(context: CatalogContext, workspaceId: Id): Promise<{ settle(): Promise<void>; publish(): Promise<void> }>;
  removeTagFromPauseChains(context: CatalogContext, tagId: Id): Promise<void>;
}
async function invalidate(ctx: CatalogContext, wid: Id, effects: CatalogTimerEffects): Promise<void> {
  const pending = await effects.prepare(ctx, wid);
  ctx.beforeCommit(`catalog-timers:${wid}`, async () => {
    await pending.settle();
    ctx.afterCommit(() => pending.publish());
  });
}
async function write<T>(ctx: CatalogContext, wid: Id, work: (ctx: CatalogContext) => Promise<T>, tag = false): Promise<T> {
  return ctx.transaction(async operation => {
    await operation.lockWorkspaces([wid]);
    try { return await work(operation); }
    catch (error) {
      if (error instanceof StorageConflict && error.kind === 'unique') throw badRequest(tag ? 'A tag with the same name already exists' : 'Name has already been taken');
      throw error;
    }
  });
}
function unique(existing: { id: number } | undefined, except?: Id, tag = false): void {
  if (existing && existing.id !== except) throw badRequest(tag ? 'A tag with the same name already exists' : 'Name has already been taken');
}
export async function getClient(ctx: CatalogRepositories, wid: Id, id: Id): Promise<Client> {
  const value = await ctx.clients.get(wid, id); if (!value) throw notFound(`No client with ID ${id} was found`); return value;
}
export async function getProject(ctx: CatalogRepositories, wid: Id, id: Id): Promise<ProjectSummary> {
  const value = await ctx.projects.get(wid, id); if (!value) throw notFound('Project not found'); return value;
}
export async function getTask(ctx: CatalogRepositories, wid: Id, id: Id, pid?: Id): Promise<TaskSummary> {
  const value = await ctx.tasks.get(wid, id, pid); if (!value) throw notFound('Task not found'); return value;
}
export async function getTag(ctx: CatalogRepositories, wid: Id, id: Id): Promise<Tag> {
  const value = await ctx.tags.get(wid, id); if (!value) throw notFound('Tag not found'); return value;
}
export function createClient(ctx: CatalogContext, wid: Id, body: Body): Promise<Client> {
  return write(ctx, wid, async ctx => {
    const name = requireName(body.name, 'Client name', 255);
    const notes = optionalString(body.notes, 'notes', 10000) ?? null;
    unique(await ctx.clients.findByName(wid, name));
    return ctx.clients.create({ workspaceId: wid, name, notes, archived: false });
  });
}
export function updateClient(ctx: CatalogContext, wid: Id, id: Id, body: Body, effects: CatalogTimerEffects): Promise<Client> {
  return write(ctx, wid, async ctx => {
    const current = await getClient(ctx, wid, id);
    const name = body.name === undefined ? current.name : requireName(body.name, 'Client name', 255);
    const notes = body.notes === undefined ? current.notes : optionalString(body.notes, 'notes', 10000) ?? null;
    unique(await ctx.clients.findByName(wid, name), id);
    await invalidate(ctx, wid, effects);
    return ctx.clients.update(wid, id, { name, notes, archived: typeof body.archived === 'boolean' ? body.archived : current.archived });
  });
}
export function setClientArchived(ctx: CatalogContext, wid: Id, id: Id, archived: boolean, effects: CatalogTimerEffects): Promise<Id[]> {
  return write(ctx, wid, async ctx => { await getClient(ctx, wid, id); await invalidate(ctx, wid, effects); return ctx.clients.setArchived(wid, id, archived); });
}
export function restoreClient(ctx: CatalogContext, wid: Id, id: Id, body: Body, effects: CatalogTimerEffects): Promise<Client> {
  return write(ctx, wid, async ctx => {
    await getClient(ctx, wid, id);
    const all = optionalBool(body.restore_all_projects, 'restore_all_projects') ?? false;
    const ids = body.projects ?? [];
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw badRequest('Invalid projects');
    const owned = await ctx.projects.listForClient(wid, id);
    const allowed = new Set(owned.map(p => p.id));
    if (ids.some(id => !allowed.has(id))) throw badRequest('Project does not belong to the client');
    await invalidate(ctx, wid, effects);
    return ctx.clients.restore(wid, id, ids, all);
  });
}
export function deleteClient(ctx: CatalogContext, wid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => { await getClient(ctx, wid, id); await invalidate(ctx, wid, effects); await ctx.clients.deleteAndDetachProjects(wid, id); });
}
async function resolveClient(ctx: CatalogContext, wid: Id, body: Body, fallback: Id | null): Promise<Id | null> {
  const id = optionalId('client_id' in body ? body.client_id : body.cid, 'client_id');
  if (id === undefined) {
    const name = optionalString(body.client_name, 'client_name', 255);
    if (!name) return fallback;
    return (await ctx.clients.findByName(wid, name.trim()) ?? await createClient(ctx, wid, { name })).id;
  }
  if (id !== null) await getClient(ctx, wid, id);
  return id;
}
function color(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !isHexColor(value)) throw badRequest('Invalid color: expected #rrggbb');
  return value.toLowerCase();
}
function date(value: unknown, field: string, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`Invalid ${field}: expected YYYY-MM-DD`);
  return value;
}
function currency(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) throw badRequest('Invalid currency: expected an ISO 4217 code');
  return value.toUpperCase();
}
function projectInput(body: Body, fallback: ProjectInput): ProjectInput {
  return { workspaceId: fallback.workspaceId, name: fallback.name, clientId: fallback.clientId,
    color: color(body.color, fallback.color), active: optionalBool(body.active, 'active') ?? fallback.active,
    isPrivate: optionalBool(body.is_private, 'is_private') ?? fallback.isPrivate, billable: optionalBool(body.billable, 'billable') ?? fallback.billable,
    estimatedHours: body.estimated_hours === undefined ? fallback.estimatedHours : optionalNumber(body.estimated_hours, 'estimated_hours') ?? null,
    rate: body.rate === undefined ? fallback.rate : optionalRate(body.rate, 'rate') ?? null, currency: currency(body.currency, fallback.currency),
    fixedFee: body.fixed_fee === undefined ? fallback.fixedFee : optionalNumber(body.fixed_fee, 'fixed_fee') ?? null,
    startDate: date(body.start_date, 'start_date', fallback.startDate), endDate: date(body.end_date, 'end_date', fallback.endDate),
    template: optionalBool(body.template, 'template') ?? fallback.template };
}
export function createProject(ctx: CatalogContext, wid: Id, body: Body): Promise<ProjectSummary> {
  return write(ctx, wid, async ctx => {
    const name = requireName(body.name, 'Project name', 255);
    const clientId = await resolveClient(ctx, wid, body, null);
    unique(await ctx.projects.findByName(wid, clientId, name));
    const fallback: ProjectInput = { workspaceId: wid, name, clientId, color: PROJECT_COLORS[(await ctx.projects.count(wid)) % PROJECT_COLORS.length]!, active: true,
      isPrivate: true, billable: false, estimatedHours: null, rate: null, currency: null, fixedFee: null, startDate: null, endDate: null, template: false };
    return ctx.projects.create(projectInput(body, fallback));
  });
}
export function updateProject(ctx: CatalogContext, wid: Id, id: Id, body: Body, effects: CatalogTimerEffects): Promise<ProjectSummary> {
  return write(ctx, wid, async ctx => {
    const current = await ctx.projects.getMetadata(wid, id); if (!current) throw notFound('Project not found');
    const name = body.name === undefined ? current.name : requireName(body.name, 'Project name', 255);
    const clientId = await resolveClient(ctx, wid, body, current.clientId);
    unique(await ctx.projects.findByName(wid, clientId, name), id);
    const input = projectInput(body, { ...current, name, clientId });
    await invalidate(ctx, wid, effects);
    return ctx.projects.update(wid, id, input);
  });
}
export function deleteProject(ctx: CatalogContext, wid: Id, id: Id, deleteEntries: boolean, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => { if (!await ctx.projects.getRef(wid, id)) throw notFound('Project not found'); await invalidate(ctx, wid, effects); await ctx.projects.delete(wid, id, deleteEntries ? 'delete' : 'detach'); });
}
export function createTask(ctx: CatalogContext, wid: Id, pid: Id, body: Body): Promise<TaskSummary> {
  return write(ctx, wid, async ctx => {
    const p = await ctx.projects.getRef(wid, pid); if (!p) throw notFound('Project not found');
    if (!p.active) throw badRequest('Can not change tasks of archived project');
    const name = requireName(body.name, 'Task name', 255);
    unique(await ctx.tasks.findByName(wid, pid, name));
    return ctx.tasks.create({ workspaceId: wid, projectId: pid, name, active: optionalBool(body.active, 'active') ?? true,
      estimatedSeconds: optionalNumber(body.estimated_seconds, 'estimated_seconds') ?? null });
  });
}
export function updateTask(ctx: CatalogContext, wid: Id, pid: Id, id: Id, body: Body, effects: CatalogTimerEffects): Promise<TaskSummary> {
  return write(ctx, wid, async ctx => {
    const current = await ctx.tasks.getMetadata(wid, id); if (!current || current.projectId !== pid) throw notFound('Task not found');
    const name = body.name === undefined ? current.name : requireName(body.name, 'Task name', 255);
    unique(await ctx.tasks.findByName(wid, pid, name), id);
    const active = optionalBool(body.active, 'active'); const estimate = optionalNumber(body.estimated_seconds, 'estimated_seconds');
    await invalidate(ctx, wid, effects);
    return ctx.tasks.update(wid, pid, id, { name, active: active ?? current.active, estimatedSeconds: estimate === undefined ? current.estimatedSeconds : estimate });
  });
}
export function deleteTask(ctx: CatalogContext, wid: Id, pid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => {
    const t = await ctx.tasks.getRef(wid, id); if (!t || t.projectId !== pid) throw notFound('Task not found');
    await invalidate(ctx, wid, effects); await ctx.tasks.delete(wid, pid, id);
  });
}
export function createTag(ctx: CatalogContext, wid: Id, body: Body): Promise<Tag> {
  return write(ctx, wid, async ctx => { const name = requireName(body.name, 'Tag name', 255); unique(await ctx.tags.findByName(wid, name), undefined, true); return ctx.tags.create(wid, name); }, true);
}
export function resolveTagNames(ctx: CatalogContext, wid: Id, names: string[]): Promise<Id[]> {
  return write(ctx, wid, async ctx => (await ctx.tags.resolveNames(wid, names.map(name => requireName(name, 'Tag name', 255)))).map(t => t.id), true);
}
export function updateTag(ctx: CatalogContext, wid: Id, id: Id, body: Body, effects: CatalogTimerEffects): Promise<Tag> {
  return write(ctx, wid, async ctx => {
    await getTag(ctx, wid, id); const name = requireName(body.name, 'Tag name', 255); unique(await ctx.tags.findByName(wid, name), id, true);
    await invalidate(ctx, wid, effects); return ctx.tags.rename(wid, id, name);
  }, true);
}
export function deleteTag(ctx: CatalogContext, wid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => { await getTag(ctx, wid, id); await invalidate(ctx, wid, effects); await effects.removeTagFromPauseChains(ctx, id); await ctx.tags.delete(wid, id); }, true);
}

export function serializeClient(row: Client) {
  return {
    id: row.id,
    wid: row.workspaceId,
    archived: row.archived,
    name: row.name,
    at: togglTime(row.updatedAt),
    notes: row.notes,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}

function projectStatus(row: ProjectSummary): string {
  if (!row.active) return 'archived';
  const today = new Date().toISOString().slice(0, 10);
  if (row.startDate && row.startDate > today) return 'upcoming';
  if (row.endDate && row.endDate < today) return 'ended';
  return 'active';
}

export function serializeProject(row: ProjectSummary, defaultCurrency: string) {
  const actualSeconds = Number(row.actualSeconds);
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    client_id: row.clientId,
    name: row.name,
    is_private: row.isPrivate,
    active: row.active,
    at: togglTime(row.updatedAt),
    created_at: togglTime(row.createdAt),
    server_deleted_at: null,
    color: row.color,
    billable: row.billable,
    template: row.template,
    auto_estimates: false,
    estimated_hours: row.estimatedHours,
    estimated_seconds: row.estimatedHours === null ? null : Math.round(row.estimatedHours * 3600),
    rate: row.rate,
    rate_last_updated: null,
    currency: row.currency,
    recurring: false,
    template_id: null,
    recurring_parameters: null,
    fixed_fee: row.fixedFee,
    actual_hours: Math.floor(actualSeconds / 3600),
    actual_seconds: actualSeconds,
    start_date: row.startDate ?? row.createdAt.slice(0, 10),
    end_date: row.endDate,
    status: projectStatus(row),
    wid: row.workspaceId,
    cid: row.clientId,
    client_name: row.clientName,
    can_track_time: true,
    pinned: false,
    permissions: null,
    workspace_default_currency: defaultCurrency,
    integration_provider: null,
    external_reference: null,
  };
}

export function serializeTask(row: TaskSummary) {
  return {
    id: row.id,
    name: row.name,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    user_id: null,
    active: row.active,
    at: togglTime(row.updatedAt),
    estimated_seconds: row.estimatedSeconds,
    // Toggl documents this field as milliseconds despite the name.
    tracked_seconds: row.trackedMilliseconds,
    server_deleted_at: null,
    project_name: row.projectName,
    project_color: row.projectColor,
    project_billable: row.projectBillable,
    project_is_private: row.projectIsPrivate,
    client_id: row.clientId,
    client_name: row.clientName,
    rate: null,
    recurring: false,
    permissions: null,
    integration_provider: null,
  };
}

export function serializeTag(row: Tag) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    at: togglTime(row.updatedAt),
    deleted_at: null,
    creator_id: null,
    integration_provider: null,
    permissions: null,
  };
}
