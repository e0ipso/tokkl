/**
 * Settlement: before a write commits, the user's timer state is made consistent (a session or a
 * pause chain whose entry stopped is dropped) and, when the visible state changed, gets a new
 * revision that is published after commit.
 */
import type { OperationContext, Repositories } from './ports.ts';
import type { Id, TagLabel, TimerSnapshot } from './model.ts';
import { encodeTimerFingerprint, IDLE_TIMER_FINGERPRINT } from './timerFingerprint.ts';
import { buildTimerView, type TimerView } from './timerView.ts';

type SettlementRepositories = Pick<Repositories, 'users' | 'entries' | 'timers' | 'tags'>;
type SettlementContext = OperationContext<SettlementRepositories>;

/** One local application instance owns this callback. No connection or database identity is exposed.
 * `incarnation` is the user row's `createdAt`. It tells apart accounts that reuse a deleted id. */
export type TimerPublication = (userId: Id, view: TimerView, incarnation: string) => Promise<void>;
export interface LocalTimerPublication {
  publish: TimerPublication;
  forgetUser(userId: Id): void;
}

/**
 * True when settling `snapshot` would write: a session or pause chain is detached from the running
 * entry, or the visible state differs from the stored revision's fingerprint. `chainTags` are the
 * pause chain's tags as stored. A state this calls settled reads the same with or without settling.
 */
export function settlementDue(snapshot: TimerSnapshot, chainTags: TagLabel[]): boolean {
  const runningId = snapshot.running?.id ?? null;
  if (snapshot.session && snapshot.session.entryId !== runningId) return true;
  if (snapshot.pauseChain && snapshot.pauseChain.cloneEntryId !== runningId) return true;
  return encodeTimerFingerprint(snapshot, chainTags) !== (snapshot.revision?.fingerprint ?? IDLE_TIMER_FINGERPRINT);
}

/** Drops a session or pause chain whose entry is no longer the running one; returns what it left. */
async function dropDetached(ctx: SettlementContext, userId: Id, data: TimerSnapshot): Promise<Set<Id>> {
  const runningId = data.running?.id ?? null;
  const left = new Set<Id>();
  if (data.session && data.session.entryId !== runningId) {
    left.add(data.session.entryId);
    await ctx.timers.deleteSession(userId);
    data.session = null;
  }
  if (data.pauseChain && data.pauseChain.cloneEntryId !== runningId) {
    await ctx.timers.deletePauseChain(userId);
    data.pauseChain = null;
  }
  return left;
}

/** The first left session entry that was discarded: deleted with a zero-length span. */
async function discardedPomodoro(ctx: SettlementContext, userId: Id, left: Set<Id>) {
  for (const id of left) {
    const entry = await ctx.entries.get(userId, id, true);
    if (entry?.deletedAt && entry.start === entry.stop) return { entryId: id, start: entry.start, stop: entry.stop };
  }
  return null;
}

/** The caller acquired the stable user parent before reading state, including absent state. */
export async function settleTimer(ctx: SettlementContext, userId: Id, publish: TimerPublication): Promise<boolean> {
  const user = await ctx.users.get(userId);
  if (!user) return false;
  const data = await ctx.timers.read(userId);
  const left = await dropDetached(ctx, userId, data);
  const tags = data.pauseChain ? await ctx.tags.findByIds(data.pauseChain.workspaceId, data.pauseChain.tagIds) : [];
  const fingerprint = encodeTimerFingerprint(data, tags);
  const changed = fingerprint !== (data.revision?.fingerprint ?? IDLE_TIMER_FINGERPRINT);
  if (changed) {
    // The session the last revision showed may be gone now; its pomodoro may be the discarded one.
    const prior = data.revision?.sessionEntryId ?? null;
    if (prior !== null && prior !== data.session?.entryId) left.add(prior);
    const discarded = await discardedPomodoro(ctx, userId, left);
    data.revision = {
      userId,
      revision: (data.revision?.revision ?? 0) + 1,
      fingerprint,
      discardedPomodoro: discarded,
      sessionEntryId: data.session?.entryId ?? null,
    };
    await ctx.timers.saveRevision(data.revision);
    const view = await buildTimerView(ctx, user, new Date(), data);
    ctx.afterCommit(() => publish(userId, view, user.createdAt));
  }
  return changed;
}

/** Settles the user's timer once, just before this transaction commits. */
export function touchTimer(ctx: SettlementContext, userId: Id, publish: TimerPublication): void {
  ctx.beforeCommit(`timer:${userId}`, async () => {
    await settleTimer(ctx, userId, publish);
  });
}
