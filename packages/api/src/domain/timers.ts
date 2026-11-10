/** Each action checks the client's revision and answers the committed view. Stops go through `stopRunningEntry`. */
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
  /** Refused unless current, since a start replaces whatever runs. See `OPTIONAL_REVISION_ACTIONS`. */
  revision?: number;
  /** The default workspace when absent or null. */
  workspaceId?: Id | null;
  /** The others come from the user's preferences. */
  lengths: Partial<PomodoroSessionConfig>;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
  /** A repeat answers the timer as it is now and starts nothing. */
  idempotency?: IdempotencyClaim;
}

export interface StartTimer {
  revision: number;
  /** The default workspace when absent or null. */
  workspaceId?: Id | null;
  /** Now when absent. */
  start?: Date;
  entry: Omit<NewEntry, 'allDay' | 'times' | 'workspaceId'>;
  idempotency?: IdempotencyClaim;
}

/** A repeat is answered before the revision check, which the first start moved on, and changes nothing. */
function startOnce(ctx: EntryContext, user: User, claim: IdempotencyClaim | undefined, start: () => Promise<Id>) {
  return idempotent(ctx, user.id, claim, { create: start, reference: id => id, replay: async id => id });
}

/** Refused unless everything it names (`revision`, `entryId` or both) still holds. */
export type EditTimer = EditPrecondition & {
  /** It stays when absent. */
  start?: Date;
  /** Absent labels stay. Its stop and workspace never change. */
  entry: Omit<EntryFields, 'workspaceId'>;
};

/** An entry id refuses only once that entry stops running, so a catalog rename causes no 409 loop. */
type EditPrecondition =
  | {
      revision: number;
      entryId?: Id;
    }
  | { revision?: undefined; entryId: Id };

/** Carries the current view, so the client can catch up without another read. */
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

/** Undefined when settling would write or the action would refuse the read; the caller then writes. */
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

/** Each action rereads the user's row under its guards, so only `signedIn.id` is used, and reads `clock` once. */
export function createTimerOperations<R extends EntryRepositories>(
  runner: TimerRunner<R>,
  signedIn: Pick<User, 'id'>,
  publish: TimerPublication,
  clock: Clock,
) {
  const userId = signedIn.id;
  /** The view is built once, after every before-commit hook of the transaction has run. */
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
  /** A new work phase stops the ended entry and starts a copy of it. */
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
  /** The chain keeps counting through the copy. */
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
    /** Read snapshot, so a read never waits for the write guards; only a state that needs settling writes. */
    async getTimerState(): Promise<TimerView> {
      const now = clock.now();
      const settled = await runner.readSnapshot(repositories => settledView(repositories, userId, now));
      return settled ? Object.freeze(settled) : action(now, async () => {});
    },
    /** Like a v9 create: a running timer stops at the new start, and its Pomodoro session or pause chain ends. */
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
    async stopTimer(revision: number, stop?: Date): Promise<TimerView> {
      const now = clock.now();
      return action(now, async (ctx, user) => {
        await checkRevision(ctx, user, revision, now);
        const e = await ctx.entries.running(user.id);
        if (!e) return refusal(ctx, user, now, 'No timer is running');
        await stopRunningEntry(ctx, user, e, stop ?? now);
      });
    },
    /** Same validation and membership check as a v9 edit. */
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
    /** Without a `revision` the pause acts on whatever runs, for older clients (`OPTIONAL_REVISION_ACTIONS`). */
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
