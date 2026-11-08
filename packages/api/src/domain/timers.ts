/**
 * Timer actions: start and stop the timer, pause, resume and discard a pause chain, and run a
 * Pomodoro session. Each action checks the revision the client saw and answers with the view as
 * committed.
 */
import { nextPhase, startSession, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { OperationContext } from '../storage/contracts.ts';
import type { EntryDetails, Id, PauseChain, PomodoroSession, User } from '../storage/domain.ts';
import { calendarInput, StateConflict } from '../lib/errors.ts';
import { getPomodoroSessionConfig } from './accountValues.ts';
import {
  getTimeEntry,
  protectEntryOperation,
  type EntryContext,
  type EntryReaders,
  type EntryRepositories,
} from './entryAccess.ts';
import type { NewEntry } from './entryCommands.ts';
import { entryDurationSeconds, wholeSeconds } from './entrySpans.ts';
import { memberWorkspace } from './membership.ts';
import { createTimeEntry, stopEntryAt } from './timeEntries.ts';
import { settleTimer, settlementDue, touchTimer, type TimerPublication } from './timerSettlement.ts';
import { buildTimerView, type TimerView } from './timerView.ts';

export interface StartPomodoro {
  /** The workspace of the session's entry; the default workspace when absent or null. */
  workspaceId?: Id | null;
  /** The lengths the client sent; the others come from the user's preferences. */
  lengths: Partial<PomodoroSessionConfig>;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
}

export interface StartTimer {
  /** The timer revision the client saw. */
  revision: number;
  /** The workspace of the new entry; the default workspace when absent or null. */
  workspaceId?: Id | null;
  /** When the entry starts; now when absent. */
  start?: Date;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
}

/** A refused timer action. It carries the current view, so the client can catch up without another read. */
export class TimerRefusal extends StateConflict<TimerView> {}
async function refusal(ctx: EntryContext, user: User, now: Date, message: string): Promise<never> {
  throw new TimerRefusal(message, await buildTimerView(ctx, user, now));
}
async function checkRevision(ctx: EntryContext, user: User, seen: number, now: Date) {
  const current = (await ctx.timers.getRevision(user.id))?.revision ?? 0;
  if (seen !== current) return refusal(ctx, user, now, `The timer changed: it is at revision ${current}, not ${seen}`);
}
async function sessionAt(ctx: EntryContext, user: User, revision: number, now: Date): Promise<PomodoroSession> {
  await checkRevision(ctx, user, revision, now);
  const s = await ctx.timers.getSession(user.id);
  if (!s) return refusal(ctx, user, now, 'No Pomodoro session is running');
  return s;
}
async function pausedAt(ctx: EntryContext, user: User, revision: number, now: Date): Promise<PauseChain> {
  await checkRevision(ctx, user, revision, now);
  const c = await ctx.timers.getPauseChain(user.id);
  if (!c || c.cloneEntryId !== null) return refusal(ctx, user, now, 'The timer is not paused');
  return c;
}
/** A running entry that starts at `start`, in whole seconds. */
const runningFrom = (start: Date, labels: StartPomodoro['entry']): NewEntry => ({
  ...labels,
  allDay: false,
  times: { start: wholeSeconds(start) },
});
const copiedLabels = (e: EntryDetails): StartPomodoro['entry'] => ({
  description: e.description,
  projectId: e.projectId,
  taskId: e.taskId,
  tagIds: e.tags.map(t => t.id),
  billable: e.billable,
  createdWith: e.createdWith,
});
export interface TimerRunner<R extends EntryRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: EntryReaders) => Promise<T>): Promise<T>;
}
type ActionWork = (ctx: EntryContext, user: User) => Promise<void>;

/**
 * The view of a user's timer read in one snapshot, when it needs no settling: the state an action
 * would answer without writing. Undefined when settling would write, or when the action would
 * refuse the read (a missing user or a missing workspace), so the caller takes the write path.
 */
async function settledView(repositories: EntryReaders, userId: Id, now: Date): Promise<TimerView | undefined> {
  const user = await repositories.users.get(userId);
  if (!user) return undefined;
  const data = await repositories.timers.read(userId);
  const wids = new Set([data.running?.workspaceId, data.pauseChain?.workspaceId]);
  for (const wid of wids) if (wid !== undefined && !(await repositories.workspaces.get(wid))) return undefined;
  const chain = data.pauseChain;
  const tags = chain ? await repositories.tags.findByIds(chain.workspaceId, chain.tagIds) : [];
  if (settlementDue(data, tags)) return undefined;
  return buildTimerView(repositories, user, now, data);
}

export function createTimerOperations<R extends EntryRepositories>(runner: TimerRunner<R>, publish: TimerPublication) {
  /**
   * Runs `work` on the settled state and answers with the view as committed. The view is built
   * once, after every before-commit hook of the whole transaction has run, and nothing changes it.
   */
  async function action(userId: Id, now: Date, work: ActionWork, wids: Id[] = [], includeDefault = false) {
    let reply: Readonly<TimerView> | undefined;
    await runner.transaction(async ctx => {
      const user = await protectEntryOperation(ctx, userId, wids, includeDefault);
      await settleTimer(ctx, userId, publish);
      await work(ctx, user);
      touchTimer(ctx, user.id, publish);
      ctx.readAtCommit(async () => {
        reply = Object.freeze(await buildTimerView(ctx, user, now));
      });
    });
    if (!reply) throw new Error('The timer reply was not built');
    return reply;
  }
  async function startPomodoroWork(ctx: EntryContext, user: User, start: StartPomodoro, wid: Id, now: Date) {
    const config = { ...getPomodoroSessionConfig(user), ...start.lengths };
    if (await ctx.timers.getSession(user.id)) return refusal(ctx, user, now, 'A Pomodoro session is already running');
    await memberWorkspace(ctx, user.id, wid);
    await ctx.timers.deletePauseChain(user.id);
    const entry = await createTimeEntry(ctx, user, wid, runningFrom(now, start.entry), publish);
    const phase = startSession(now);
    await ctx.timers.saveSession({
      userId: user.id,
      entryId: entry.id,
      config,
      phase: { kind: phase.kind, startedAt: phase.startedAt.toISOString(), completed: phase.completed },
    });
  }
  /** Moves the session on. A new work phase stops the ended entry and starts a copy of it. */
  async function nextPhaseWork(ctx: EntryContext, user: User, seen: number, now: Date) {
    const s = await sessionAt(ctx, user, seen, now);
    const { next } = calendarInput(() =>
      nextPhase(
        { kind: s.phase.kind, startedAt: new Date(s.phase.startedAt), completed: s.phase.completed },
        now,
        s.config,
      ),
    );
    let entryId = s.entryId;
    if (next.kind === 'work') {
      const ended = await getTimeEntry(ctx, user.id, s.entryId);
      await stopEntryAt(ctx, user, ended, now);
      entryId = (await createTimeEntry(ctx, user, ended.workspaceId, runningFrom(now, copiedLabels(ended)), publish))
        .id;
    }
    await ctx.timers.saveSession({
      ...s,
      entryId,
      phase: { kind: next.kind, startedAt: next.startedAt.toISOString(), completed: next.completed },
    });
  }
  /** Stops the running entry and adds its stored length to the pause chain. */
  async function pauseWork(ctx: EntryContext, user: User, now: Date) {
    if (await ctx.timers.getSession(user.id)) return refusal(ctx, user, now, 'A Pomodoro session cannot be paused');
    const e = await ctx.entries.running(user.id);
    if (!e) return refusal(ctx, user, now, 'No timer is running');
    await stopEntryAt(ctx, user, e, now);
    const stored = entryDurationSeconds(await getTimeEntry(ctx, user.id, e.id, { includeDeleted: true }));
    const c = await ctx.timers.getPauseChain(user.id);
    await ctx.timers.savePauseChain({
      userId: user.id,
      workspaceId: e.workspaceId,
      projectId: e.projectId,
      taskId: e.taskId,
      description: e.description,
      tagIds: e.tags.map(t => t.id),
      billable: e.billable,
      seconds: (c?.cloneEntryId === e.id ? c.seconds : 0) + stored,
      cloneEntryId: null,
    });
  }
  /** Starts a copy of the paused entry; the chain keeps counting through it. */
  async function resumeWork(ctx: EntryContext, user: User, seen: number, now: Date) {
    const c = await pausedAt(ctx, user, seen, now),
      tags = await ctx.tags.findByIds(c.workspaceId, c.tagIds);
    const labels = {
      description: c.description,
      projectId: c.projectId,
      taskId: c.taskId,
      tagIds: tags.map(t => t.id),
      billable: c.billable,
    };
    const clone = await createTimeEntry(ctx, user, c.workspaceId, runningFrom(now, labels), publish);
    await ctx.timers.savePauseChain({ ...c, cloneEntryId: clone.id });
  }
  return {
    /**
     * Reads the timer in a read snapshot, so a read never waits for the write guards. Only a state
     * that settling would change takes the write path, which settles, numbers and publishes it.
     */
    async getTimerState(userId: Id, now = new Date()): Promise<TimerView> {
      const settled = await runner.readSnapshot(repositories => settledView(repositories, userId, now));
      return settled ? Object.freeze(settled) : action(userId, now, async () => {});
    },
    /**
     * Starts a running entry the way a v9 create does: a running timer stops at the new start,
     * and a Pomodoro session or pause chain it belonged to ends.
     */
    async startTimer(userId: Id, start: StartTimer, now = new Date()): Promise<TimerView> {
      const explicit = start.workspaceId;
      return action(
        userId,
        now,
        async (ctx, user) => {
          await checkRevision(ctx, user, start.revision, now);
          const entry = runningFrom(start.start ?? now, start.entry);
          await createTimeEntry(ctx, user, explicit ?? user.defaultWorkspaceId, entry, publish);
        },
        explicit ? [explicit] : [],
        !explicit,
      );
    },
    /** Stops the running entry at `stop`, or now, the way a v9 stop does. */
    async stopTimer(userId: Id, revision: number, stop?: Date, now = new Date()): Promise<TimerView> {
      return action(userId, now, async (ctx, user) => {
        await checkRevision(ctx, user, revision, now);
        const e = await ctx.entries.running(user.id);
        if (!e) return refusal(ctx, user, now, 'No timer is running');
        // Like a v9 stop: only a member of the entry's workspace may stop it.
        await memberWorkspace(ctx, user.id, e.workspaceId);
        await stopEntryAt(ctx, user, e, stop ?? now);
      });
    },
    async startPomodoro(userId: Id, start: StartPomodoro, now = new Date()): Promise<TimerView> {
      const explicit = start.workspaceId;
      return action(
        userId,
        now,
        (ctx, user) => startPomodoroWork(ctx, user, start, explicit ?? user.defaultWorkspaceId, now),
        explicit ? [explicit] : [],
        !explicit,
      );
    },
    async nextPomodoroPhase(userId: Id, revision: number, now = new Date()): Promise<TimerView> {
      return action(userId, now, (ctx, user) => nextPhaseWork(ctx, user, revision, now));
    },
    async endPomodoro(userId: Id, revision: number, now = new Date()): Promise<TimerView> {
      return action(userId, now, async (ctx, user) => {
        const s = await sessionAt(ctx, user, revision, now);
        await stopEntryAt(ctx, user, await getTimeEntry(ctx, user.id, s.entryId), now);
        await ctx.timers.deleteSession(user.id);
      });
    },
    async pauseTimer(userId: Id, now = new Date()): Promise<TimerView> {
      return action(userId, now, (ctx, user) => pauseWork(ctx, user, now));
    },
    async resumeTimer(userId: Id, revision: number, now = new Date()): Promise<TimerView> {
      return action(userId, now, (ctx, user) => resumeWork(ctx, user, revision, now));
    },
    async discardPause(userId: Id, revision: number, now = new Date()): Promise<TimerView> {
      return action(userId, now, async (ctx, user) => {
        await pausedAt(ctx, user, revision, now);
        await ctx.timers.deletePauseChain(user.id);
      });
    },
  };
}
export type TimerOperations = ReturnType<typeof createTimerOperations>;
