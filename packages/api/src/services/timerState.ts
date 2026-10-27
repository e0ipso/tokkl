import {
  nextPhase, plannedEnd, POMODORO_SESSION_CONFIG_RANGES, startSession, transitionKind,
  type PomodoroSessionConfig, type SessionPhase, type SessionPhaseKind, type TransitionKind,
} from '@tokkl/common/pomodoroSession';
import type { DiscardedPomodoro, TimeEntry, TimerPause, TimerPomodoro, TimerState } from '@tokkl/types';
import { transaction, type Db } from '../db/index.ts';
import { badRequest, ConflictWithBody } from '../lib/errors.ts';
import { asBool, optionalId } from '../lib/values.ts';
import { findTags, type TagRow } from '../models/tags.ts';
import {
  createTimeEntry, currentTagIds, entryDurationSeconds, getRunningEntry, getTimeEntry, serializeTimeEntry, stopEntryAt,
  type TimeEntryRow, type TimeEntryWithMeta,
} from '../models/timeEntries.ts';
import {
  createPomodoroSession, deletePauseChain, deletePomodoroSession, getPauseChain, getPomodoroSession, getTimerStateRow,
  savePauseChain, savePomodoroPhase, setPauseChainClone, settleTimer, touchTimer,
  type PauseChainRow, type PomodoroSessionRow, type TimerStateRow,
} from '../models/timerState.ts';
import { getPomodoroSessionConfig, type UserRow } from '../models/users.ts';
import { memberWorkspace } from '../models/workspaces.ts';

/** The field of the start body that overrides each session length. */
const LENGTH_FIELDS: Readonly<Record<keyof PomodoroSessionConfig, string>> = {
  workMinutes: 'work_minutes',
  shortRestMinutes: 'short_rest_minutes',
  longRestMinutes: 'long_rest_minutes',
  longRestEvery: 'long_rest_every',
};

/** The phase each transition starts. */
const UPCOMING_PHASE: Readonly<Record<TransitionKind, SessionPhaseKind>> = {
  workToShortRest: 'shortRest',
  workToLongRest: 'longRest',
  shortRestToWork: 'work',
  longRestToWork: 'work',
};

/**
 * `user`'s timer at `now`: the running entry, the pause chain, and the Pomodoro session with the
 * values clients count down and ring by. It settles the user first, so a write that skipped
 * settlement shows here as it would after any other write.
 */
export function getTimerState(db: Db, user: UserRow, now: Date = new Date()): TimerState {
  return transaction(db, () => {
    settleTimer(db, user.id);
    return buildState(db, user, now);
  });
}

/**
 * Starts a Pomodoro session at `now`. Refused while a session runs. Its first pomodoro is a new
 * running entry, which stops the running entry at the same instant, and any pause chain ends.
 * `body` may carry `workspace_id` (the user's default workspace otherwise), the entry fields a v9
 * start takes (`description`, `project_id`, `task_id`, `tag_ids` or `tags`, `billable` and
 * `created_with`), and `work_minutes`, `short_rest_minutes`, `long_rest_minutes` and
 * `long_rest_every`, each of which overrides the user's preference for this session.
 */
export function startPomodoro(db: Db, user: UserRow, body: Record<string, unknown>, now: Date = new Date()): TimerState {
  const config = readSessionConfig(body, getPomodoroSessionConfig(user));
  return runAction(db, user, now, () => {
    if (getPomodoroSession(db, user.id)) throw refusal(db, user, now, 'A Pomodoro session is already running');
    const wid = optionalId(body.workspace_id, 'workspace_id') ?? user.default_workspace_id;
    deletePauseChain(db, user.id);
    const entry = startEntry(db, user, wid, {
      description: body.description, project_id: body.project_id, task_id: body.task_id, tag_ids: body.tag_ids,
      tags: body.tags, billable: body.billable, created_with: body.created_with,
    }, now);
    createPomodoroSession(db, user.id, entry.id, config, startSession(now));
  });
}

/**
 * Confirms Next phase at `now`, if the state is still at `revision`. Work to rest changes the
 * session only. Rest to work ends the open pomodoro: its entry stops at `now`, snapped as any timer
 * stop is, and the next pomodoro starts at the exact `now` with the stopped entry's fields, so
 * edits made to it through any client carry over.
 */
export function nextPomodoroPhase(db: Db, user: UserRow, revision: unknown, now: Date = new Date()): TimerState {
  const seen = readRevision(revision);
  return runAction(db, user, now, () => {
    const session = sessionAt(db, user, now, seen);
    const { next } = nextPhase(phaseOf(session), now, configOf(session));
    let entryId = session.entry_id;
    if (next.kind === 'work') {
      const ended = getTimeEntry(db, user.id, session.entry_id);
      stopEntryAt(db, user, ended, now);
      entryId = startEntry(db, user, ended.workspace_id, pomodoroFields(ended), now).id;
    }
    savePomodoroPhase(db, user.id, entryId, next);
  });
}

/**
 * Ends the session at `now`, if the state is still at `revision`. The open pomodoro's entry stops
 * at `now`, snapped as any timer stop is.
 */
export function endPomodoro(db: Db, user: UserRow, revision: unknown, now: Date = new Date()): TimerState {
  const seen = readRevision(revision);
  return runAction(db, user, now, () => {
    const session = sessionAt(db, user, now, seen);
    stopEntryAt(db, user, getTimeEntry(db, user.id, session.entry_id), now);
    deletePomodoroSession(db, user.id);
  });
}

/**
 * Pauses the running entry at `now`. Refused during a session and while nothing runs. The entry
 * stops, snapped as any timer stop is, and the chain records its fields for Resume and adds the
 * seconds it stored, which are none when the stop rounded to zero. Pausing the chain's running
 * clone extends the chain; pausing any other entry starts one.
 */
export function pauseTimer(db: Db, user: UserRow, now: Date = new Date()): TimerState {
  return runAction(db, user, now, () => {
    if (getPomodoroSession(db, user.id)) throw refusal(db, user, now, 'A Pomodoro session cannot be paused');
    const running = getRunningEntry(db, user.id);
    if (!running) throw refusal(db, user, now, 'No timer is running');
    stopEntryAt(db, user, running, now);
    // A stop that rounded to zero left the entry in the trash with zero length.
    const stored = entryDurationSeconds(getTimeEntry(db, user.id, running.id, { includeDeleted: true }));
    const chain = getPauseChain(db, user.id);
    const carried = chain?.clone_entry_id === running.id ? chain.seconds : 0;
    savePauseChain(db, {
      user_id: user.id, workspace_id: running.workspace_id, project_id: running.project_id, task_id: running.task_id,
      description: running.description, tag_ids_json: JSON.stringify(currentTagIds(running)), billable: running.billable,
      seconds: carried + stored, clone_entry_id: null,
    });
  });
}

/**
 * Resumes the paused chain at `now`, if the state is still at `revision`, with a running clone of
 * the chain's fields. Tags deleted since the pause are left out.
 */
export function resumeTimer(db: Db, user: UserRow, revision: unknown, now: Date = new Date()): TimerState {
  const seen = readRevision(revision);
  return runAction(db, user, now, () => {
    const chain = pausedChainAt(db, user, now, seen);
    const clone = startEntry(db, user, chain.workspace_id, {
      description: chain.description, project_id: chain.project_id, task_id: chain.task_id,
      tag_ids: chainTags(db, chain).map((tag) => tag.id), billable: asBool(chain.billable),
    }, now);
    setPauseChainClone(db, user.id, clone.id);
  });
}

/**
 * Ends the paused chain, if the state is still at `revision`: Stop while paused. It writes no
 * entry, because Pause stored each one already.
 */
export function discardPause(db: Db, user: UserRow, revision: unknown, now: Date = new Date()): TimerState {
  const seen = readRevision(revision);
  return runAction(db, user, now, () => {
    pausedChainAt(db, user, now, seen);
    deletePauseChain(db, user.id);
  });
}

/**
 * Runs `action` in one transaction, on the state as settlement leaves it, and returns the state it
 * leads to. Settling first means a refusal and the revision check see what a read would see.
 */
function runAction(db: Db, user: UserRow, now: Date, action: () => void): TimerState {
  return transaction(db, () => {
    touchTimer(db, user.id);
    settleTimer(db, user.id);
    action();
    return getTimerState(db, user, now);
  });
}

/**
 * The session lengths: each override in `body`, checked against its range, or else the user's
 * preference. A null override counts as none.
 */
function readSessionConfig(body: Record<string, unknown>, preferences: PomodoroSessionConfig): PomodoroSessionConfig {
  const config = { ...preferences };
  for (const key of Object.keys(LENGTH_FIELDS) as Array<keyof PomodoroSessionConfig>) {
    const field = LENGTH_FIELDS[key];
    const value = body[field];
    if (value === undefined || value === null) continue;
    const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw badRequest(`Invalid ${field}: expected an integer from ${min} to ${max}`);
    }
    config[key] = value;
  }
  return config;
}

/** The revision a client saw, which a change that depends on it carries. Anything but an integer is a 400. */
function readRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw badRequest('Invalid revision: expected an integer');
  return value;
}

/**
 * A 409 for an action the state refuses, carrying the state as it stands. Throw it before the
 * action writes anything, so the state it carries is the one the rollback leaves.
 */
function refusal(db: Db, user: UserRow, now: Date, message: string): ConflictWithBody<TimerState> {
  return new ConflictWithBody(message, getTimerState(db, user, now));
}

/** Refuses unless the state is still at `revision`, so a second device's confirm cannot act on a state it never saw. */
function assertRevision(db: Db, user: UserRow, now: Date, revision: number): void {
  const current = getTimerStateRow(db, user.id)?.revision ?? 0;
  if (revision !== current) {
    throw refusal(db, user, now, `The timer changed: it is at revision ${current}, not ${revision}`);
  }
}

/** The session, while the state is still at `revision`. */
function sessionAt(db: Db, user: UserRow, now: Date, revision: number): PomodoroSessionRow {
  assertRevision(db, user, now, revision);
  const session = getPomodoroSession(db, user.id);
  if (!session) throw refusal(db, user, now, 'No Pomodoro session is running');
  return session;
}

/** The paused chain, while the state is still at `revision`. A chain whose clone runs is not paused. */
function pausedChainAt(db: Db, user: UserRow, now: Date, revision: number): PauseChainRow {
  assertRevision(db, user, now, revision);
  const chain = getPauseChain(db, user.id);
  if (!chain || chain.clone_entry_id !== null) throw refusal(db, user, now, 'The timer is not paused');
  return chain;
}

/** Starts a running entry at `now` in workspace `wid`, which the user must belong to. It stops the running entry at `now`. */
function startEntry(db: Db, user: UserRow, wid: number, fields: Record<string, unknown>, now: Date): TimeEntryWithMeta {
  memberWorkspace(db, user.id, wid);
  return createTimeEntry(db, user, wid, { ...fields, start: now.toISOString() });
}

/** The fields the next pomodoro copies from the entry of the one that ended. */
function pomodoroFields(entry: TimeEntryWithMeta): Record<string, unknown> {
  return {
    description: entry.description, project_id: entry.project_id, task_id: entry.task_id,
    tag_ids: currentTagIds(entry), billable: asBool(entry.billable), created_with: entry.created_with,
  };
}

function phaseOf(session: PomodoroSessionRow): SessionPhase {
  return { kind: session.phase_kind, startedAt: new Date(session.phase_start), completed: session.completed };
}

function configOf(session: PomodoroSessionRow): PomodoroSessionConfig {
  return {
    workMinutes: session.work_minutes,
    shortRestMinutes: session.short_rest_minutes,
    longRestMinutes: session.long_rest_minutes,
    longRestEvery: session.long_rest_every,
  };
}

/** The state as stored, without settling it first. */
function buildState(db: Db, user: UserRow, now: Date): TimerState {
  const stored = getTimerStateRow(db, user.id);
  const running = getRunningEntry(db, user.id);
  const chain = getPauseChain(db, user.id);
  const session = getPomodoroSession(db, user.id);
  return {
    revision: stored?.revision ?? 0,
    server_time: now.toISOString(),
    // The v9 serializer builds its object untyped; with meta it holds every TimeEntry field.
    running_entry: running ? serializeTimeEntry(running, { meta: true, user }) as unknown as TimeEntry : null,
    pause: chain ? pauseOf(db, chain) : null,
    pomodoro: session && running ? pomodoroOf(session, running) : null,
    discarded_pomodoro: discardedOf(stored),
  };
}

function pauseOf(db: Db, chain: PauseChainRow): TimerPause {
  const tags = chainTags(db, chain);
  return {
    paused: chain.clone_entry_id === null,
    seconds: chain.seconds,
    workspace_id: chain.workspace_id,
    description: chain.description,
    project_id: chain.project_id,
    task_id: chain.task_id,
    tag_ids: tags.map((tag) => tag.id),
    tags: tags.map((tag) => tag.name),
    billable: asBool(chain.billable),
    clone_entry_id: chain.clone_entry_id,
  };
}

/** The chain's tags that still exist, in name order: the ones a resumed clone gets. */
function chainTags(db: Db, chain: PauseChainRow): TagRow[] {
  return findTags(db, chain.workspace_id, JSON.parse(chain.tag_ids_json) as number[]);
}

/** `session` on its open pomodoro, the running entry `entry`. */
function pomodoroOf(session: PomodoroSessionRow, entry: TimeEntryRow): TimerPomodoro {
  const phase = phaseOf(session);
  const config = configOf(session);
  const transition = transitionKind(phase, config);
  return {
    work_minutes: config.workMinutes,
    short_rest_minutes: config.shortRestMinutes,
    long_rest_minutes: config.longRestMinutes,
    long_rest_every: config.longRestEvery,
    phase: {
      kind: phase.kind,
      start: phase.startedAt.toISOString(),
      completed: phase.completed,
      planned_end: plannedEnd(phase, config).toISOString(),
    },
    upcoming_phase: UPCOMING_PHASE[transition],
    transition,
    // A rest counts the work phase it follows, so it shows the number of that pomodoro.
    number: phase.kind === 'work' ? phase.completed + 1 : phase.completed,
    entry_id: session.entry_id,
    pomodoro_start: new Date(entry.start).toISOString(),
  };
}

function discardedOf(stored: TimerStateRow | undefined): DiscardedPomodoro | null {
  if (!stored || stored.discarded_entry_id === null || stored.discarded_start === null || stored.discarded_stop === null) {
    return null;
  }
  return {
    entry_id: stored.discarded_entry_id,
    start: new Date(stored.discarded_start).toISOString(),
    stop: new Date(stored.discarded_stop).toISOString(),
  };
}
