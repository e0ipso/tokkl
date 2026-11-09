/**
 * Timer work that catalog and account operations need: they change what a running entry shows, or
 * delete its owner, and must settle and publish the affected timers.
 */
import type { Id } from './model.ts';
import type { AccountRepositories } from './accountGuards.ts';
import type { AccountEntryEffects } from './accounts.ts';
import type { CatalogTimerEffects } from './catalogs.ts';
import type { EntryContext, EntryRepositories } from './entryAccess.ts';
import { reanchorNoTimeEntries } from './timeEntries.ts';
import { settleTimer, touchTimer, type LocalTimerPublication, type TimerPublication } from './timerSettlement.ts';
import type { TimerView } from './timerView.ts';

interface PreparedWorkspace {
  users: Set<Id>;
  retain: TimerPublication;
  settle(): Promise<void>;
  publish(): Promise<void>;
}

/** Holds committed states until `publish`, which runs after commit and release. */
function prepareWorkspace(full: EntryContext, publish: TimerPublication): PreparedWorkspace {
  const users = new Set<Id>(),
    committed: Array<{ id: Id; view: TimerView; incarnation: string }> = [];
  const retain: TimerPublication = async (id, view, incarnation) => {
    committed.push({ id, view, incarnation });
  };
  return {
    users,
    retain,
    async settle() {
      for (const id of [...users].sort((a, b) => a - b)) await settleTimer(full, id, retain);
    },
    async publish() {
      let failed = false;
      for (const event of committed.splice(0)) {
        try {
          await publish(event.id, event.view, event.incarnation);
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error('Timer publication failed');
    },
  };
}

/** Bind inside the full transaction callback. The catalog port must receive that exact context. */
export function createCatalogTimerEffects(full: EntryContext, publish: TimerPublication): CatalogTimerEffects {
  function same(ctx: object) {
    if (ctx !== full) throw new Error('Timer effects require the same operation context');
  }
  const prepared = new Map<Id, PreparedWorkspace>();
  return {
    async prepare(ctx, wid) {
      same(ctx);
      const users = await full.timers.affectedUsers(wid);
      await full.lockUsers(users);
      let pending = prepared.get(wid);
      if (!pending) prepared.set(wid, (pending = prepareWorkspace(full, publish)));
      for (const id of users) pending.users.add(id);
      // Retain initial owners even when a later preparation follows a destructive edit.
      for (const id of pending.users) touchTimer(full, id, pending.retain);
      return pending;
    },
    async removeTagFromPauseChains(ctx, tagId) {
      same(ctx);
      await full.timers.removeTagFromPauseChains(tagId);
    },
  };
}

export function createAccountEntryEffects<R extends AccountRepositories & EntryRepositories>(
  push: LocalTimerPublication,
): AccountEntryEffects<R> {
  const timerOwners = async (ctx: EntryContext, workspaces: Array<{ id: Id }>) => [
    ...new Set((await Promise.all(workspaces.map(w => ctx.timers.affectedUsers(w.id)))).flat()),
  ];
  return {
    async reanchorTimezone(ctx, id, from, to) {
      await reanchorNoTimeEntries(ctx, id, from, to);
      touchTimer(ctx, id, push.publish);
    },
    async affectedDeletionUsers(ctx, _id, workspaces) {
      return (await timerOwners(ctx, workspaces)).sort((a, b) => a - b);
    },
    async beforeDelete(ctx, user, workspaces) {
      for (const id of await timerOwners(ctx, workspaces)) if (id !== user.id) touchTimer(ctx, id, push.publish);
      ctx.afterCommit(async () => {
        push.forgetUser(user.id);
      });
    },
  };
}
