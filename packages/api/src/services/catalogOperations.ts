/** Each write takes the workspace guard, checks membership, guards affected timers and publishes after commit. */
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
import type { Id } from '../domain/model.ts';

/** `storage` checks the member's credential around each transaction. */
export function createCatalogOperations(storage: EntryTransactions, memberId: Id, publish: TimerPublication) {
  function write<T>(wid: Id, work: (ctx: EntryContext, effects: CatalogTimerEffects) => Promise<T>) {
    return storage.transaction(async ctx => {
      await ctx.lockWorkspaces([wid]);
      if (!(await ctx.workspaces.forMember(memberId, wid))) throw noWorkspaceAccess();
      await ctx.lockUsers([memberId, ...(await ctx.timers.affectedUsers(wid))]);
      return work(ctx, createCatalogTimerEffects(ctx, publish));
    });
  }
  /** A repeat reads the record back by id. */
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
    createProject: (wid: Id, project: NewProject, claim?: IdempotencyClaim) =>
      create(
        wid,
        claim,
        ctx => createProject(ctx, wid, project),
        (ctx, id) => getProject(ctx, wid, id),
      ),
    updateProject: (wid: Id, id: Id, changes: ProjectChanges) =>
      write(wid, (ctx, effects) => updateProject(ctx, wid, id, changes, effects)),
    /** Without `deleteEntries` the entries lose their project. */
    deleteProject: (wid: Id, id: Id, deleteEntries: boolean) =>
      write(wid, (ctx, effects) => deleteProject(ctx, wid, id, deleteEntries, effects)),
    createTask: (wid: Id, projectId: Id, task: NewTask, claim?: IdempotencyClaim) =>
      create(
        wid,
        claim,
        ctx => createTask(ctx, wid, projectId, task),
        (ctx, id) => getTask(ctx, wid, id, projectId),
      ),
    updateTask: (wid: Id, projectId: Id, id: Id, changes: TaskChanges) =>
      write(wid, (ctx, effects) => updateTask(ctx, wid, projectId, id, changes, effects)),
    deleteTask: (wid: Id, projectId: Id, id: Id) =>
      write(wid, (ctx, effects) => deleteTask(ctx, wid, projectId, id, effects)),
    createClient: (wid: Id, client: NewClient, claim?: IdempotencyClaim) =>
      create(
        wid,
        claim,
        ctx => createClient(ctx, wid, client),
        (ctx, id) => getClient(ctx, wid, id),
      ),
    updateClient: (wid: Id, id: Id, changes: ClientChanges) =>
      write(wid, (ctx, effects) => updateClient(ctx, wid, id, changes, effects)),
    /** Answers the ids of the projects it archived. */
    archiveClient: (wid: Id, id: Id) => write(wid, (ctx, effects) => setClientArchived(ctx, wid, id, true, effects)),
    restoreClient: (wid: Id, id: Id, restore: ClientRestore) =>
      write(wid, (ctx, effects) => restoreClient(ctx, wid, id, restore, effects)),
    deleteClient: (wid: Id, id: Id) => write(wid, (ctx, effects) => deleteClient(ctx, wid, id, effects)),
    createTag: (wid: Id, name: string, claim?: IdempotencyClaim) =>
      create(
        wid,
        claim,
        ctx => createTag(ctx, wid, name),
        (ctx, id) => getTag(ctx, wid, id),
      ),
    updateTag: (wid: Id, id: Id, name: string) => write(wid, (ctx, effects) => updateTag(ctx, wid, id, name, effects)),
    deleteTag: (wid: Id, id: Id) => write(wid, (ctx, effects) => deleteTag(ctx, wid, id, effects)),
  };
}
