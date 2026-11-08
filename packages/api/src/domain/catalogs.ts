/**
 * Clients, projects, tasks and tags of a workspace. Writes take the workspace guard, keep names
 * unique, and settle the timers whose running entry shows the changed record.
 */
import { PROJECT_COLORS } from '@tokkl/common/colors';
import type {
  ClientsReader,
  OperationContext,
  ProjectInput,
  ProjectsReader,
  Repositories,
  TagsReader,
  TasksReader,
} from '../storage/contracts.ts';
import type { Client, Id, ProjectSummary, TaskSummary, Tag } from '../storage/domain.ts';
import { StorageConflict } from '../storage/errors.ts';
import { invalidInput, notFound } from '../lib/errors.ts';
import { requireName } from '../lib/values.ts';
import {
  MAX_NAME_LENGTH,
  type ClientChanges,
  type ClientChoice,
  type ClientRestore,
  type NewClient,
  type NewProject,
  type NewTask,
  type ProjectChanges,
  type ProjectFields,
  type TaskChanges,
} from './catalogCommands.ts';

export type CatalogRepositories = Pick<Repositories, 'clients' | 'projects' | 'tasks' | 'tags'>;
export type CatalogContext = OperationContext<CatalogRepositories>;
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
/** Runs `work` in the caller's transaction under the workspace guard; a duplicate name is a 400. */
async function write<T>(
  ctx: CatalogContext,
  wid: Id,
  work: (ctx: CatalogContext) => Promise<T>,
  tag = false,
): Promise<T> {
  await ctx.lockWorkspaces([wid]);
  try {
    return await work(ctx);
  } catch (error) {
    if (error instanceof StorageConflict && error.kind === 'unique')
      throw invalidInput(tag ? 'A tag with the same name already exists' : 'Name has already been taken');
    throw error;
  }
}
function unique(existing: { id: number } | undefined, except?: Id, tag = false): void {
  if (existing && existing.id !== except)
    throw invalidInput(tag ? 'A tag with the same name already exists' : 'Name has already been taken');
}
export async function getClient(ctx: { clients: Pick<ClientsReader, 'get'> }, wid: Id, id: Id): Promise<Client> {
  const value = await ctx.clients.get(wid, id);
  if (!value) throw notFound(`No client with ID ${id} was found`);
  return value;
}
export async function getProject(
  ctx: { projects: Pick<ProjectsReader, 'get'> },
  wid: Id,
  id: Id,
): Promise<ProjectSummary> {
  const value = await ctx.projects.get(wid, id);
  if (!value) throw notFound('Project not found');
  return value;
}
export async function getTask(
  ctx: { tasks: Pick<TasksReader, 'get'> },
  wid: Id,
  id: Id,
  pid?: Id,
): Promise<TaskSummary> {
  const value = await ctx.tasks.get(wid, id, pid);
  if (!value) throw notFound('Task not found');
  return value;
}
export async function getTag(ctx: { tags: Pick<TagsReader, 'get'> }, wid: Id, id: Id): Promise<Tag> {
  const value = await ctx.tags.get(wid, id);
  if (!value) throw notFound('Tag not found');
  return value;
}
export function createClient(ctx: CatalogContext, wid: Id, client: NewClient): Promise<Client> {
  return write(ctx, wid, async ctx => {
    unique(await ctx.clients.findByName(wid, client.name));
    return ctx.clients.create({ workspaceId: wid, name: client.name, notes: client.notes, archived: false });
  });
}
export function updateClient(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  changes: ClientChanges,
  effects: CatalogTimerEffects,
): Promise<Client> {
  return write(ctx, wid, async ctx => {
    const current = await getClient(ctx, wid, id);
    const name = changes.name ?? current.name;
    unique(await ctx.clients.findByName(wid, name), id);
    await invalidate(ctx, wid, effects);
    return ctx.clients.update(wid, id, {
      name,
      notes: changes.notes === undefined ? current.notes : changes.notes,
      archived: changes.archived ?? current.archived,
    });
  });
}
export function setClientArchived(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  archived: boolean,
  effects: CatalogTimerEffects,
): Promise<Id[]> {
  return write(ctx, wid, async ctx => {
    await getClient(ctx, wid, id);
    await invalidate(ctx, wid, effects);
    return ctx.clients.setArchived(wid, id, archived);
  });
}
export function restoreClient(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  restore: ClientRestore,
  effects: CatalogTimerEffects,
): Promise<Client> {
  return write(ctx, wid, async ctx => {
    await getClient(ctx, wid, id);
    const owned = new Set((await ctx.projects.listForClient(wid, id)).map(p => p.id));
    if (restore.projectIds.some(pid => !owned.has(pid))) throw invalidInput('Project does not belong to the client');
    await invalidate(ctx, wid, effects);
    return ctx.clients.restore(wid, id, restore.projectIds, restore.allProjects);
  });
}
export function deleteClient(ctx: CatalogContext, wid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => {
    await getClient(ctx, wid, id);
    await invalidate(ctx, wid, effects);
    await ctx.clients.deleteAndDetachProjects(wid, id);
  });
}
/** The chosen client's id; one chosen by name is created when missing. */
async function resolveClient(
  ctx: CatalogContext,
  wid: Id,
  choice: ClientChoice | undefined,
  fallback: Id | null,
): Promise<Id | null> {
  if (!choice) return fallback;
  if ('name' in choice)
    return (
      (await ctx.clients.findByName(wid, choice.name)) ??
      (await createClient(ctx, wid, { name: choice.name, notes: null }))
    ).id;
  if (choice.id !== null) await getClient(ctx, wid, choice.id);
  return choice.id;
}
/** The stored project fields: each sent field, else the fallback's. */
function projectInput(fields: ProjectFields, fallback: ProjectInput): ProjectInput {
  const pick = <K extends keyof ProjectFields & keyof ProjectInput>(key: K) =>
    (fields[key] === undefined ? fallback[key] : fields[key]) as ProjectInput[K];
  return {
    workspaceId: fallback.workspaceId,
    name: fallback.name,
    clientId: fallback.clientId,
    color: pick('color'),
    active: pick('active'),
    isPrivate: pick('isPrivate'),
    billable: pick('billable'),
    estimatedHours: pick('estimatedHours'),
    rate: pick('rate'),
    currency: pick('currency'),
    fixedFee: pick('fixedFee'),
    startDate: pick('startDate'),
    endDate: pick('endDate'),
    template: pick('template'),
  };
}
export function createProject(ctx: CatalogContext, wid: Id, project: NewProject): Promise<ProjectSummary> {
  return write(ctx, wid, async ctx => {
    const clientId = await resolveClient(ctx, wid, project.client, null);
    unique(await ctx.projects.findByName(wid, clientId, project.name));
    const fallback: ProjectInput = {
      workspaceId: wid,
      name: project.name,
      clientId,
      color: PROJECT_COLORS[(await ctx.projects.count(wid)) % PROJECT_COLORS.length]!,
      active: true,
      isPrivate: true,
      billable: false,
      estimatedHours: null,
      rate: null,
      currency: null,
      fixedFee: null,
      startDate: null,
      endDate: null,
      template: false,
    };
    return ctx.projects.create(projectInput(project, fallback));
  });
}
export function updateProject(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  changes: ProjectChanges,
  effects: CatalogTimerEffects,
): Promise<ProjectSummary> {
  return write(ctx, wid, async ctx => {
    const current = await ctx.projects.getMetadata(wid, id);
    if (!current) throw notFound('Project not found');
    const name = changes.name ?? current.name;
    const clientId = await resolveClient(ctx, wid, changes.client, current.clientId);
    unique(await ctx.projects.findByName(wid, clientId, name), id);
    const input = projectInput(changes, { ...current, name, clientId });
    await invalidate(ctx, wid, effects);
    return ctx.projects.update(wid, id, input);
  });
}
export function deleteProject(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  deleteEntries: boolean,
  effects: CatalogTimerEffects,
): Promise<void> {
  return write(ctx, wid, async ctx => {
    if (!(await ctx.projects.getRef(wid, id))) throw notFound('Project not found');
    await invalidate(ctx, wid, effects);
    await ctx.projects.delete(wid, id, deleteEntries ? 'delete' : 'detach');
  });
}
export function createTask(ctx: CatalogContext, wid: Id, pid: Id, task: NewTask): Promise<TaskSummary> {
  return write(ctx, wid, async ctx => {
    const p = await ctx.projects.getRef(wid, pid);
    if (!p) throw notFound('Project not found');
    if (!p.active) throw invalidInput('Can not change tasks of archived project');
    unique(await ctx.tasks.findByName(wid, pid, task.name));
    return ctx.tasks.create({
      workspaceId: wid,
      projectId: pid,
      name: task.name,
      active: task.active ?? true,
      estimatedSeconds: task.estimatedSeconds ?? null,
    });
  });
}
export function updateTask(
  ctx: CatalogContext,
  wid: Id,
  pid: Id,
  id: Id,
  changes: TaskChanges,
  effects: CatalogTimerEffects,
): Promise<TaskSummary> {
  return write(ctx, wid, async ctx => {
    const current = await ctx.tasks.getMetadata(wid, id);
    if (!current || current.projectId !== pid) throw notFound('Task not found');
    const name = changes.name ?? current.name;
    unique(await ctx.tasks.findByName(wid, pid, name), id);
    await invalidate(ctx, wid, effects);
    return ctx.tasks.update(wid, pid, id, {
      name,
      active: changes.active ?? current.active,
      estimatedSeconds: changes.estimatedSeconds === undefined ? current.estimatedSeconds : changes.estimatedSeconds,
    });
  });
}
export function deleteTask(ctx: CatalogContext, wid: Id, pid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(ctx, wid, async ctx => {
    const t = await ctx.tasks.getRef(wid, id);
    if (!t || t.projectId !== pid) throw notFound('Task not found');
    await invalidate(ctx, wid, effects);
    await ctx.tasks.delete(wid, pid, id);
  });
}
export function createTag(ctx: CatalogContext, wid: Id, name: string): Promise<Tag> {
  return write(
    ctx,
    wid,
    async ctx => {
      unique(await ctx.tags.findByName(wid, name), undefined, true);
      return ctx.tags.create(wid, name);
    },
    true,
  );
}
/** Tag ids by name, creating missing tags. Each name is trimmed and must not be blank. */
export function resolveTagNames(ctx: CatalogContext, wid: Id, names: string[]): Promise<Id[]> {
  return write(
    ctx,
    wid,
    async ctx =>
      (
        await ctx.tags.resolveNames(
          wid,
          names.map(name => requireName(name, 'Tag name', MAX_NAME_LENGTH)),
        )
      ).map(t => t.id),
    true,
  );
}
export function updateTag(
  ctx: CatalogContext,
  wid: Id,
  id: Id,
  name: string,
  effects: CatalogTimerEffects,
): Promise<Tag> {
  return write(
    ctx,
    wid,
    async ctx => {
      await getTag(ctx, wid, id);
      unique(await ctx.tags.findByName(wid, name), id, true);
      await invalidate(ctx, wid, effects);
      return ctx.tags.rename(wid, id, name);
    },
    true,
  );
}
export function deleteTag(ctx: CatalogContext, wid: Id, id: Id, effects: CatalogTimerEffects): Promise<void> {
  return write(
    ctx,
    wid,
    async ctx => {
      await getTag(ctx, wid, id);
      await invalidate(ctx, wid, effects);
      await effects.removeTagFromPauseChains(ctx, id);
      await ctx.tags.delete(wid, id);
    },
    true,
  );
}
