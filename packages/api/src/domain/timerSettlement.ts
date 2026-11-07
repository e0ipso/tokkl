/**
 * Settlement: before a write commits, the user's timer state is made consistent (a session or a
 * pause chain whose entry stopped is dropped) and, when the visible state changed, gets a new
 * revision that is published after commit.
 */
import type { OperationContext, Repositories } from '../storage/contracts.ts';
import type { Id, TagLabel, TimerSnapshot } from '../storage/domain.ts';
import { buildTimerView, type TimerView } from './timerView.ts';

export type SettlementRepositories = Pick<Repositories, 'users' | 'entries' | 'timers' | 'tags'>;
export type SettlementContext = OperationContext<SettlementRepositories>;

/** One local application instance owns this callback. No connection or database identity is exposed.
 * `incarnation` is the user row's `createdAt`. It tells apart accounts that reuse a deleted id. */
export type TimerPublication = (userId: Id, view: TimerView, incarnation: string) => Promise<void>;
export type LocalTimerPublication = TimerPublication & { forgetUser(userId: Id): void };

const orderedTags = (tags: TagLabel[]) => [...tags].sort((a, b) => a.id - b.id).map(t => ({ id: t.id, name: t.name }));
/** Canonical domain fields only. Audit/driver JSON representations never number visible state. */
export function timerFingerprint(snapshot: TimerSnapshot, chainTags: TagLabel[]): string {
  const e = snapshot.running,
    c = snapshot.pauseChain,
    s = snapshot.session;
  return JSON.stringify({
    running: e && {
      id: e.id,
      workspaceId: e.workspaceId,
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      start: e.start,
      billable: e.billable,
      tags: orderedTags(e.tags),
      project: e.project && {
        name: e.project.name,
        color: e.project.color,
        active: e.project.active,
        billable: e.project.billable,
      },
      client: e.client && { id: e.client.id, name: e.client.name },
      task: e.task && { name: e.task.name, active: e.task.active },
    },
    session: s && {
      userId: s.userId,
      entryId: s.entryId,
      config: {
        workMinutes: s.config.workMinutes,
        shortRestMinutes: s.config.shortRestMinutes,
        longRestMinutes: s.config.longRestMinutes,
        longRestEvery: s.config.longRestEvery,
      },
      phase: { kind: s.phase.kind, startedAt: s.phase.startedAt, completed: s.phase.completed },
    },
    chain: c && {
      userId: c.userId,
      workspaceId: c.workspaceId,
      projectId: c.projectId,
      taskId: c.taskId,
      description: c.description,
      tagIds: [...c.tagIds].sort((a, b) => a - b),
      billable: c.billable,
      seconds: c.seconds,
      cloneEntryId: c.cloneEntryId,
      tags: orderedTags(chainTags),
    },
  });
}
const idleFingerprint = timerFingerprint({ running: null, pauseChain: null, session: null, revision: null }, []);

interface PendingReply {
  view: TimerView;
  at: Date;
}
/** Replies this transaction has handed out for a user; settlement keeps them current until commit. */
function pendingReplies(ctx: SettlementContext, userId: Id): PendingReply[] {
  const replies = ctx.local('timer-replies', () => new Map<Id, PendingReply[]>());
  let list = replies.get(userId);
  if (!list) replies.set(userId, (list = []));
  return list;
}
/** Keeps `view` equal to the state this transaction commits, through every later settlement. */
export function holdReply(ctx: SettlementContext, userId: Id, view: TimerView, at: Date): void {
  pendingReplies(ctx, userId).push({ view, at });
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
  const fingerprint = timerFingerprint(data, tags);
  const changed = fingerprint !== (data.revision?.fingerprint ?? idleFingerprint);
  if (changed) {
    const prior = data.revision
      ? (JSON.parse(data.revision.fingerprint) as { session: { entryId: Id } | null }).session?.entryId
      : undefined;
    if (prior !== undefined && prior !== data.session?.entryId) left.add(prior);
    const discarded = await discardedPomodoro(ctx, userId, left);
    data.revision = { userId, revision: (data.revision?.revision ?? 0) + 1, fingerprint, discardedPomodoro: discarded };
    await ctx.timers.saveRevision(data.revision);
    const view = await buildTimerView(ctx, user, new Date(), data);
    ctx.afterCommit(() => publish(userId, view, user.createdAt));
  }
  for (const reply of pendingReplies(ctx, userId))
    Object.assign(reply.view, await buildTimerView(ctx, user, reply.at, data));
  return changed;
}

/** Settles the user's timer once, just before this transaction commits. */
export function touchTimer(ctx: SettlementContext, userId: Id, publish: TimerPublication): void {
  ctx.beforeCommit(`timer:${userId}`, async () => {
    await settleTimer(ctx, userId, publish);
  });
}
