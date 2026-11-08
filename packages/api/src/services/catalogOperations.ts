/**
 * The catalog writes a signed-in member makes in a workspace: clients, projects, tasks and tags.
 * Each is one transaction that takes the workspace guard, checks membership, guards every timer
 * the write may change, and publishes the changed timers after commit.
 */
import type {
  ClientChanges,
  ClientRestore,
  NewClient,
  NewProject,
  NewTask,
  ProjectChanges,
  TaskChanges,
} from '../domain/catalogCommands.ts';
import {
  createClient,
  createProject,
  createTag,
  createTask,
  deleteClient,
  deleteProject,
  deleteTag,
  deleteTask,
  getClient,
  getProject,
  getTag,
  getTask,
  restoreClient,
  setClientArchived,
  updateClient,
  updateProject,
  updateTag,
  updateTask,
  type CatalogTimerEffects,
} from '../domain/catalogs.ts';
import type { EntryContext, EntryTransactions } from '../domain/entryAccess.ts';
import { idempotent } from '../domain/idempotency.ts';
import type { IdempotencyClaim } from '../lib/idempotency.ts';
import { noWorkspaceAccess } from '../domain/membership.ts';
import { createCatalogTimerEffects } from '../domain/timerEffects.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import type { Client, Id, ProjectSummary, Tag, TaskSummary } from '../storage/domain.ts';

/** Each create takes an optional `Idempotency-Key` claim; see `domain/idempotency.ts`. */
export interface CatalogOperations {
  createProject(wid: Id, project: NewProject, claim?: IdempotencyClaim): Promise<ProjectSummary>;
  updateProject(wid: Id, id: Id, changes: ProjectChanges): Promise<ProjectSummary>;
  /** `deleteEntries` deletes the project's entries too; otherwise they lose their project. */
  deleteProject(wid: Id, id: Id, deleteEntries: boolean): Promise<void>;
  createTask(wid: Id, projectId: Id, task: NewTask, claim?: IdempotencyClaim): Promise<TaskSummary>;
  updateTask(wid: Id, projectId: Id, id: Id, changes: TaskChanges): Promise<TaskSummary>;
  deleteTask(wid: Id, projectId: Id, id: Id): Promise<void>;
  createClient(wid: Id, client: NewClient, claim?: IdempotencyClaim): Promise<Client>;
  updateClient(wid: Id, id: Id, changes: ClientChanges): Promise<Client>;
  /** Archives a client and its projects; answers the ids of the projects it archived. */
  archiveClient(wid: Id, id: Id): Promise<Id[]>;
  restoreClient(wid: Id, id: Id, restore: ClientRestore): Promise<Client>;
  deleteClient(wid: Id, id: Id): Promise<void>;
  createTag(wid: Id, name: string, claim?: IdempotencyClaim): Promise<Tag>;
  updateTag(wid: Id, id: Id, name: string): Promise<Tag>;
  deleteTag(wid: Id, id: Id): Promise<void>;
}

/** `storage` checks the member's credential around each transaction. */
export function createCatalogOperations(
  storage: EntryTransactions,
  memberId: Id,
  publish: TimerPublication,
): CatalogOperations {
  /** Runs `work` under the workspace guard and the guards of every timer it may change. */
  function write<T>(wid: Id, work: (ctx: EntryContext, effects: CatalogTimerEffects) => Promise<T>) {
    return storage.transaction(async ctx => {
      await ctx.lockWorkspaces([wid]);
      if (!(await ctx.workspaces.forMember(memberId, wid))) throw noWorkspaceAccess();
      await ctx.lockUsers([memberId, ...(await ctx.timers.affectedUsers(wid))]);
      return work(ctx, createCatalogTimerEffects(ctx, publish));
    });
  }
  /** A create under `write`, run once per idempotency key; a repeat reads the record back by id. */
  function create<T extends { id: Id }>(
    wid: Id,
    claim: IdempotencyClaim | undefined,
    make: (ctx: EntryContext) => Promise<T>,
    read: (ctx: EntryContext, id: Id) => Promise<T>,
  ) {
    return write(wid, ctx =>
      idempotent(ctx, memberId, claim, {
        create: () => make(ctx),
        reference: record => record.id,
        replay: id => read(ctx, id),
      }),
    );
  }
  return {
    createProject: (wid, project, claim) =>
      create(
        wid,
        claim,
        ctx => createProject(ctx, wid, project),
        (ctx, id) => getProject(ctx, wid, id),
      ),
    updateProject: (wid, id, changes) => write(wid, (ctx, effects) => updateProject(ctx, wid, id, changes, effects)),
    deleteProject: (wid, id, deleteEntries) =>
      write(wid, (ctx, effects) => deleteProject(ctx, wid, id, deleteEntries, effects)),
    createTask: (wid, projectId, task, claim) =>
      create(
        wid,
        claim,
        ctx => createTask(ctx, wid, projectId, task),
        (ctx, id) => getTask(ctx, wid, id, projectId),
      ),
    updateTask: (wid, projectId, id, changes) =>
      write(wid, (ctx, effects) => updateTask(ctx, wid, projectId, id, changes, effects)),
    deleteTask: (wid, projectId, id) => write(wid, (ctx, effects) => deleteTask(ctx, wid, projectId, id, effects)),
    createClient: (wid, client, claim) =>
      create(
        wid,
        claim,
        ctx => createClient(ctx, wid, client),
        (ctx, id) => getClient(ctx, wid, id),
      ),
    updateClient: (wid, id, changes) => write(wid, (ctx, effects) => updateClient(ctx, wid, id, changes, effects)),
    archiveClient: (wid, id) => write(wid, (ctx, effects) => setClientArchived(ctx, wid, id, true, effects)),
    restoreClient: (wid, id, restore) => write(wid, (ctx, effects) => restoreClient(ctx, wid, id, restore, effects)),
    deleteClient: (wid, id) => write(wid, (ctx, effects) => deleteClient(ctx, wid, id, effects)),
    createTag: (wid, name, claim) =>
      create(
        wid,
        claim,
        ctx => createTag(ctx, wid, name),
        (ctx, id) => getTag(ctx, wid, id),
      ),
    updateTag: (wid, id, name) => write(wid, (ctx, effects) => updateTag(ctx, wid, id, name, effects)),
    deleteTag: (wid, id) => write(wid, (ctx, effects) => deleteTag(ctx, wid, id, effects)),
  };
}
