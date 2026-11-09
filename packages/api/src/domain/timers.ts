/**
 * Timer actions: start and stop the timer, pause, resume and discard a pause chain, and run a
 * Pomodoro session. Each action checks the revision the client saw and answers with the view as
 * committed. Every stop of the running entry goes through `stopRunningEntry`, which refuses a user
 * who is no longer a member of the entry's workspace.
 */
import { nextPhase, startSession, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { Clock, OperationContext } from './ports.ts';
import type { EntryDetails, Id, PauseChain, PomodoroSession, User } from './model.ts';
import { calendarInput, StateConflict } from '../lib/errors.ts';
import { getPomodoroSessionConfig } from './accountValues.ts';
import { getTimeEntry, protectEntryOperation, type EntryContext, type EntryRepositories } from './entryAccess.ts';
import type { EntryFields, NewEntry } from './entryCommands.ts';
import { entryDurationSeconds, wholeSeconds } from './entrySpans.ts';
import { idempotent } from './idempotency.ts';
import { memberWorkspace } from './membership.ts';
import type { IdempotencyClaim } from '../lib/idempotency.ts';
import { createTimeEntry, stopRunningEntry, updateTimeEntry } from './timeEntries.ts';
import { settleTimer, settlementDue, touchTimer, type TimerPublication } from './timerSettlement.ts';
import { buildTimerView, type TimerView } from './timerView.ts';

export interface StartPomodoro {
  /**
   * The timer revision the client saw; the start is refused unless it is current, because a start
   * replaces whatever runs. Absent only for older clients: `OPTIONAL_REVISION_ACTIONS` in
   * `commands/timers.ts` says which client may omit it and when that ends.
   */
  revision?: number;
  /** The workspace of the session's entry; the default workspace when absent or null. */
  workspaceId?: Id | null;
  /** The lengths the client sent; the others come from the user's preferences. */
  lengths: Partial<PomodoroSessionConfig>;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
  /** The request's `Idempotency-Key`; a repeat answers the timer as it is now and starts nothing. */
  idempotency?: IdempotencyClaim;
}

export interface StartTimer {
  /** The timer revision the client saw. */
  revision: number;
  /** The workspace of the new entry; the default workspace when absent or null. */
  workspaceId?: Id | null;
  /** When the entry starts; now when absent. */
  start?: Date;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
  /** The request's `Idempotency-Key`; a repeat answers the timer as it is now and starts nothing. */
  idempotency?: IdempotencyClaim;
}

/**
 * Runs a start once per idempotency key. A repeat is answered before the revision check, which the
 * first start moved on, and changes nothing: the action's reply is then the timer as it is now.
 */
function startOnce(ctx: EntryContext, user: User, claim: IdempotencyClaim | undefined, start: () => Promise<Id>) {
  return idempotent(ctx, user.id, claim, { create: start, reference: id => id, replay: async id => id });
}

/**
 * An edit of the running entry. It names what the client saw with `revision`, `entryId` or both,
 * and is refused unless each one it names still holds.
 */
export type EditTimer = EditPrecondition & {
  /** A new start for the running entry; it stays when absent. */
  start?: Date;
  /** The running entry's labels to change; absent ones stay. Its stop and workspace never change. */
  entry: Omit<EntryFields, 'workspaceId'>;
};

/**
 * What an edit checks before it acts. A revision refuses the edit after any change to the timer;
 * an entry id refuses it only once that entry no longer runs, so an unrelated change, such as a
 * catalog rename the running entry shows, does not send the client round a 409 loop.
 */
export type EditPrecondition =
  | {
      /** The timer revision the client saw. */ revision: number;
      /** The entry the client saw running. */ entryId?: Id;
    }
  | { revision?: undefined; entryId: Id };

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
  readSnapshot<T>(work: (repositories: EntryRepositories) => Promise<T>): Promise<T>;
}
type ActionWork = (ctx: EntryContext, user: User) => Promise<void>;

/**
 * The view of a user's timer read in one snapshot, when it needs no settling: the state an action
 * would answer without writing. Undefined when settling would write, or when the action would
 * refuse the read (a missing user or a missing workspace), so the caller takes the write path.
 */
async function settledView(repositories: EntryRepositories, userId: Id, now: Date): Promise<TimerView | undefined> {
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

/**
 * The timer operations of one user. Each action reads the user's row again under its guards, so
 * only `signedIn.id` is used. Each action reads the time once, from `clock`.
 */
export function createTimerOperations<R extends EntryRepositories>(
  runner: TimerRunner<R>,
  signedIn: Pick<User, 'id'>,
  publish: TimerPublication,
  clock: Clock,
) {
  const userId = signedIn.id;
  /**
   * Runs `work` on the settled state and answers with the view as committed. The view is built
   * once, after every before-commit hook of the whole transaction has run, and nothing changes it.
   */
  async function action(now: Date, work: ActionWork, wids: Id[] = [], includeDefault = false) {
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
  /** Starts a session and answers the id of its first pomodoro's entry. */
  async function startPomodoroWork(ctx: EntryContext, user: User, start: StartPomodoro, wid: Id, now: Date) {
    if (start.revision !== undefined) await checkRevision(ctx, user, start.revision, now);
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
    return entry.id;
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
      await stopRunningEntry(ctx, user, ended, now);
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
  async function pauseWork(ctx: EntryContext, user: User, revision: number | undefined, now: Date) {
    if (revision !== undefined) await checkRevision(ctx, user, revision, now);
    if (await ctx.timers.getSession(user.id)) return refusal(ctx, user, now, 'A Pomodoro session cannot be paused');
    const e = await ctx.entries.running(user.id);
    if (!e) return refusal(ctx, user, now, 'No timer is running');
    await stopRunningEntry(ctx, user, e, now);
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
    async getTimerState(): Promise<TimerView> {
      const now = clock.now();
      const settled = await runner.readSnapshot(repositories => settledView(repositories, userId, now));
      return settled ? Object.freeze(settled) : action(now, async () => {});
    },
    /**
     * Starts a running entry the way a v9 create does: a running timer stops at the new start,
     * and a Pomodoro session or pause chain it belonged to ends.
     */
    async startTimer(start: StartTimer): Promise<TimerView> {
      const now = clock.now();
      const explicit = start.workspaceId;
      return action(
        now,
        async (ctx, user) => {
          await startOnce(ctx, user, start.idempotency, async () => {
            await checkRevision(ctx, user, start.revision, now);
            const entry = runningFrom(start.start ?? now, start.entry);
            return (await createTimeEntry(ctx, user, explicit ?? user.defaultWorkspaceId, entry, publish)).id;
          });
        },
        explicit ? [explicit] : [],
        !explicit,
      );
    },
    /** Stops the running entry at `stop`, or now, the way a v9 stop does. */
    async stopTimer(revision: number, stop?: Date): Promise<TimerView> {
      const now = clock.now();
      return action(now, async (ctx, user) => {
        await checkRevision(ctx, user, revision, now);
        const e = await ctx.entries.running(user.id);
        if (!e) return refusal(ctx, user, now, 'No timer is running');
        await stopRunningEntry(ctx, user, e, stop ?? now);
      });
    },
    /**
     * Edits the running entry's labels and start the way a v9 edit of it does, with the same
     * validation and the same membership check.
     */
    async editTimer(edit: EditTimer): Promise<TimerView> {
      const now = clock.now();
      return action(now, async (ctx, user) => {
        if (edit.revision !== undefined) await checkRevision(ctx, user, edit.revision, now);
        const e = await ctx.entries.running(user.id);
        if (!e) return refusal(ctx, user, now, 'No timer is running');
        if (edit.entryId !== undefined && edit.entryId !== e.id)
          return refusal(ctx, user, now, `Entry ${edit.entryId} is no longer the running entry`);
        const times = edit.start ? { start: edit.start } : {};
        await updateTimeEntry(ctx, user, e.workspaceId, e.id, { ...edit.entry, times, tagAction: 'replace' }, publish);
      });
    },
    async startPomodoro(start: StartPomodoro): Promise<TimerView> {
      const now = clock.now();
      const explicit = start.workspaceId;
      return action(
        now,
        async (ctx, user) => {
          await startOnce(ctx, user, start.idempotency, () =>
            startPomodoroWork(ctx, user, start, explicit ?? user.defaultWorkspaceId, now),
          );
        },
        explicit ? [explicit] : [],
        !explicit,
      );
    },
    async nextPomodoroPhase(revision: number): Promise<TimerView> {
      const now = clock.now();
      return action(now, (ctx, user) => nextPhaseWork(ctx, user, revision, now));
    },
    async endPomodoro(revision: number): Promise<TimerView> {
      const now = clock.now();
      return action(now, async (ctx, user) => {
        const s = await sessionAt(ctx, user, revision, now);
        await stopRunningEntry(ctx, user, await getTimeEntry(ctx, user.id, s.entryId), now);
        await ctx.timers.deleteSession(user.id);
      });
    },
    /**
     * Pauses the running entry. A `revision` is checked like any other action's; without one the
     * pause acts on whatever runs, for older clients (see `OPTIONAL_REVISION_ACTIONS` in
     * `commands/timers.ts`).
     */
    async pauseTimer(revision: number | undefined): Promise<TimerView> {
      const now = clock.now();
      return action(now, (ctx, user) => pauseWork(ctx, user, revision, now));
    },
    async resumeTimer(revision: number): Promise<TimerView> {
      const now = clock.now();
      return action(now, (ctx, user) => resumeWork(ctx, user, revision, now));
    },
    async discardPause(revision: number): Promise<TimerView> {
      const now = clock.now();
      return action(now, async (ctx, user) => {
        await pausedAt(ctx, user, revision, now);
        await ctx.timers.deletePauseChain(user.id);
      });
    },
  };
}
export type TimerOperations = ReturnType<typeof createTimerOperations>;
