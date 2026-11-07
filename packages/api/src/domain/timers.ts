/**
 * Timer actions: pause, resume and discard a pause chain, and run a Pomodoro session. Each action
 * checks the revision the client saw and answers with the view as committed.
 */
import {
  nextPhase,
  POMODORO_SESSION_CONFIG_RANGES,
  startSession,
  type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import type { OperationContext } from '../storage/contracts.ts';
import type { EntryDetails, Id, PauseChain, PomodoroSession, User } from '../storage/domain.ts';
import { calendarInput, invalidInput, StateConflict } from '../lib/errors.ts';
import { optionalId } from '../lib/values.ts';
import { getPomodoroSessionConfig } from './accountValues.ts';
import {
  createTimeEntry,
  entryDurationSeconds,
  getTimeEntry,
  protectEntryOperation,
  stopEntryAt,
  type EntryContext,
  type EntryRepositories,
} from './timeEntries.ts';
import { memberWorkspace } from './membership.ts';
import { holdReply, settleTimer, touchTimer, type TimerPublication } from './timerSettlement.ts';
import { buildTimerView, type TimerView } from './timerView.ts';

const lengthFields = {
  workMinutes: 'work_minutes',
  shortRestMinutes: 'short_rest_minutes',
  longRestMinutes: 'long_rest_minutes',
  longRestEvery: 'long_rest_every',
} as const;
function readConfig(body: Record<string, unknown>, user: User): PomodoroSessionConfig {
  const config = getPomodoroSessionConfig(user);
  for (const key of Object.keys(lengthFields) as Array<keyof PomodoroSessionConfig>) {
    const field = lengthFields[key],
      value = body[field];
    if (value == null) continue;
    const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      throw invalidInput(`Invalid ${field}: expected an integer from ${min} to ${max}`);
    config[key] = value;
  }
  return config;
}
function readRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw invalidInput('Invalid revision: expected an integer');
  return value;
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
const copiedFields = (e: EntryDetails) => ({
  description: e.description,
  project_id: e.projectId,
  task_id: e.taskId,
  tag_ids: e.tags.map(t => t.id),
  billable: e.billable,
  created_with: e.createdWith,
});
export interface TimerRunner<R extends EntryRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
type ActionWork = (ctx: EntryContext, user: User) => Promise<void>;

export function createTimerOperations<R extends EntryRepositories>(runner: TimerRunner<R>, publish: TimerPublication) {
  /**
   * Runs `work` on the settled state and answers with the view as committed: every later
   * settlement in the same transaction, before-commit hooks included, updates the reply.
   */
  function action(userId: Id, now: Date, work: ActionWork, wids: Id[] = [], includeDefault = false) {
    return runner.transaction(async ctx => {
      const user = await protectEntryOperation(ctx, userId, wids, includeDefault);
      await settleTimer(ctx, userId, publish);
      await work(ctx, user);
      const reply = await buildTimerView(ctx, user, now);
      holdReply(ctx, user.id, reply, now);
      touchTimer(ctx, user.id, publish);
      return reply;
    });
  }
  async function startPomodoroWork(ctx: EntryContext, user: User, body: Record<string, unknown>, wid: Id, now: Date) {
    const config = readConfig(body, user);
    if (await ctx.timers.getSession(user.id)) return refusal(ctx, user, now, 'A Pomodoro session is already running');
    await memberWorkspace(ctx, user.id, wid);
    await ctx.timers.deletePauseChain(user.id);
    const entry = await createTimeEntry(
      ctx,
      user,
      wid,
      {
        description: body.description,
        project_id: body.project_id,
        task_id: body.task_id,
        tag_ids: body.tag_ids,
        tags: body.tags,
        billable: body.billable,
        created_with: body.created_with,
        start: now.toISOString(),
      },
      publish,
    );
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
      const copy = { ...copiedFields(ended), start: now.toISOString() };
      entryId = (await createTimeEntry(ctx, user, ended.workspaceId, copy, publish)).id;
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
    const clone = await createTimeEntry(
      ctx,
      user,
      c.workspaceId,
      {
        description: c.description,
        project_id: c.projectId,
        task_id: c.taskId,
        tag_ids: tags.map(t => t.id),
        billable: c.billable,
        start: now.toISOString(),
      },
      publish,
    );
    await ctx.timers.savePauseChain({ ...c, cloneEntryId: clone.id });
  }
  return {
    async getTimerState(userId: Id, now = new Date()): Promise<TimerView> {
      return action(userId, now, async () => {});
    },
    async startPomodoro(userId: Id, body: Record<string, unknown>, now = new Date()): Promise<TimerView> {
      const explicit = optionalId(body.workspace_id, 'workspace_id');
      return action(
        userId,
        now,
        (ctx, user) => startPomodoroWork(ctx, user, body, explicit ?? user.defaultWorkspaceId, now),
        explicit ? [explicit] : [],
        !explicit,
      );
    },
    async nextPomodoroPhase(userId: Id, revision: unknown, now = new Date()): Promise<TimerView> {
      const seen = readRevision(revision);
      return action(userId, now, (ctx, user) => nextPhaseWork(ctx, user, seen, now));
    },
    async endPomodoro(userId: Id, revision: unknown, now = new Date()): Promise<TimerView> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => {
        const s = await sessionAt(ctx, user, seen, now);
        await stopEntryAt(ctx, user, await getTimeEntry(ctx, user.id, s.entryId), now);
        await ctx.timers.deleteSession(user.id);
      });
    },
    async pauseTimer(userId: Id, now = new Date()): Promise<TimerView> {
      return action(userId, now, (ctx, user) => pauseWork(ctx, user, now));
    },
    async resumeTimer(userId: Id, revision: unknown, now = new Date()): Promise<TimerView> {
      const seen = readRevision(revision);
      return action(userId, now, (ctx, user) => resumeWork(ctx, user, seen, now));
    },
    async discardPause(userId: Id, revision: unknown, now = new Date()): Promise<TimerView> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => {
        await pausedAt(ctx, user, seen, now);
        await ctx.timers.deletePauseChain(user.id);
      });
    },
  };
}
export type TimerOperations = ReturnType<typeof createTimerOperations>;
