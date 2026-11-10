import type { EntryDetails, Id, ProjectRef } from './model.ts';
import { invalidInput, notFound } from '../lib/errors.ts';
import { resolveTagNames } from './catalogs.ts';
import type { EntryContext, EntryRepositories } from './entryAccess.ts';
import type { EntryFields, TagAction } from './entryCommands.ts';

/** An import wraps them in a cache. */
export interface EntryReferences {
  project: EntryRepositories['projects']['getRef'];
  task: EntryRepositories['tasks']['getRef'];
  tags: EntryRepositories['tags']['findByIds'];
  tagNames(wid: Id, names: string[]): Promise<Id[]>;
}

export function entryReferences(ctx: EntryContext): EntryReferences {
  return {
    project: (wid, id) => ctx.projects.getRef(wid, id),
    task: (wid, id) => ctx.tasks.getRef(wid, id),
    tags: (wid, ids) => ctx.tags.findByIds(wid, ids),
    tagNames: (wid, names) => resolveTagNames(ctx, wid, names),
  };
}

/** `tagIds` must exist; `tagNames` are created when missing. */
export async function resolveTagIds(
  refs: EntryReferences,
  wid: Id,
  { tagIds, tagNames }: Pick<EntryFields, 'tagIds' | 'tagNames'>,
): Promise<Id[] | undefined> {
  let ids = tagIds;
  if (ids) {
    const found = await refs.tags(wid, ids);
    for (const id of ids) if (!found.some(tag => tag.id === id)) throw notFound('Tag not found');
  }
  if (tagNames) ids = [...(ids ?? []), ...(await refs.tagNames(wid, tagNames))];
  return ids === undefined ? undefined : [...new Set(ids)];
}

export function applyTagAction(current: Id[], incoming: Id[] | undefined, action: TagAction): Id[] {
  if (incoming === undefined) return current;
  if (action === 'add') return [...new Set([...current, ...incoming])];
  if (action === 'delete') return current.filter(id => !incoming.includes(id));
  return incoming;
}

export function currentTagIds(row: EntryDetails): Id[] {
  return row.tags.map(tag => tag.id);
}

interface ResolvedProject {
  projectId: Id | null;
  taskId: Id | null;
  project: ProjectRef | null | undefined;
  projectChanged: boolean;
}

/** A task implies its project, and changing the project alone clears the task. */
export async function resolveProjectAndTask(
  refs: EntryReferences,
  wid: Id,
  sent: Pick<EntryFields, 'projectId' | 'taskId'>,
  current: { projectId: Id | null; taskId: Id | null },
): Promise<ResolvedProject> {
  let projectId = sent.projectId === undefined ? current.projectId : sent.projectId;
  let taskId = sent.taskId === undefined ? current.taskId : sent.taskId;
  const projectChanged = sent.projectId !== undefined && sent.projectId !== current.projectId;
  if (projectChanged && sent.taskId === undefined) taskId = null;
  if (taskId !== null) {
    const task = await refs.task(wid, taskId);
    if (!task) throw notFound('Task not found');
    if (projectId === null) projectId = task.projectId;
    else if (task.projectId !== projectId) throw invalidInput('Task does not belong to the project');
  }
  const project = projectId === null ? null : await refs.project(wid, projectId);
  if (projectId !== null && !project) throw notFound('Project not found');
  return { projectId, taskId, project, projectChanged };
}
