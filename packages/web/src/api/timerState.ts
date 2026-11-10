import { onlineManager, type Mutation, type QueryClient } from '@tanstack/react-query';
import { ApiError, RequestTimeoutError, UnparsableReplyError } from './client.ts';
import { DecodeError, isRecord } from './decode.ts';
import { clockOffset } from './serverClock.ts';
import type {
  DiscardedPomodoro,
  TimeEntry,
  TimerPause,
  TimerPomodoro,
  TimerPomodoroPhase,
  TimerState,
} from '@tokkl/types';
import { isFiniteNumber, isInstant, isSafeInteger } from '@tokkl/common/validators';
import { t } from '../i18n/messages.ts';

export const TIMER_CONFLICT_MESSAGE = t('timer.conflict');

export const TIMER_OFFLINE_MESSAGE = t('timer.offline');

/** The timer moved on, or the server was unreachable. */
export class TimerActionError extends Error {
  readonly kind: 'conflict' | 'offline';
  /** Set for a conflict. */
  readonly state: TimerState | null;

  constructor(kind: 'conflict' | 'offline', state: TimerState | null = null) {
    super(kind === 'conflict' ? TIMER_CONFLICT_MESSAGE : TIMER_OFFLINE_MESSAGE);
    this.kind = kind;
    this.state = state;
  }
}

type Check = (value: unknown) => boolean;

const text: Check = value => typeof value === 'string';
const flag: Check = value => typeof value === 'boolean';
const nullable =
  (check: Check): Check =>
  value =>
    value === null || check(value);
const listOf =
  (check: Check): Check =>
  value =>
    Array.isArray(value) && value.every(check);
const oneOf =
  (...values: readonly string[]): Check =>
  value =>
    values.some(candidate => candidate === value);

/** A field added to `T` must be checked too. */
function shape<T>(fields: { readonly [K in keyof T]-?: Check }): Check {
  const entries: Array<[string, Check]> = Object.entries(fields);
  return value => isRecord(value) && entries.every(([key, check]) => check(value[key]));
}

const id = nullable(isSafeInteger);
const metaName: Check = value => value === undefined || value === null || text(value);
const phaseKind = oneOf('work', 'shortRest', 'longRest');

const isEntry = shape<TimeEntry>({
  id: isSafeInteger,
  workspace_id: isSafeInteger,
  project_id: id,
  task_id: id,
  billable: flag,
  start: isInstant,
  stop: nullable(isInstant),
  duration: isFiniteNumber,
  description: text,
  tags: listOf(text),
  tag_ids: listOf(isSafeInteger),
  at: isInstant,
  server_deleted_at: nullable(isInstant),
  all_day: flag,
  project_name: metaName,
  project_color: metaName,
  client_name: metaName,
  task_name: metaName,
});

const isPause = shape<TimerPause>({
  paused: flag,
  seconds: isFiniteNumber,
  workspace_id: isSafeInteger,
  description: text,
  project_id: id,
  task_id: id,
  tag_ids: listOf(isSafeInteger),
  tags: listOf(text),
  billable: flag,
  clone_entry_id: id,
});

const isPomodoro = shape<TimerPomodoro>({
  work_minutes: isFiniteNumber,
  short_rest_minutes: isFiniteNumber,
  long_rest_minutes: isFiniteNumber,
  long_rest_every: isFiniteNumber,
  phase: shape<TimerPomodoroPhase>({
    kind: phaseKind,
    start: isInstant,
    completed: isSafeInteger,
    planned_end: isInstant,
  }),
  upcoming_phase: phaseKind,
  transition: oneOf('workToShortRest', 'shortRestToWork', 'workToLongRest', 'longRestToWork'),
  number: isSafeInteger,
  entry_id: isSafeInteger,
  pomodoro_start: isInstant,
});

const isState = shape<TimerState>({
  revision: isSafeInteger,
  server_time: isInstant,
  running_entry: nullable(isEntry),
  pause: nullable(isPause),
  pomodoro: nullable(isPomodoro),
  discarded_pomodoro: nullable(
    shape<DiscardedPomodoro>({ entry_id: isSafeInteger, start: isInstant, stop: isInstant }),
  ),
});

/** Running entry, pause and session included. */
export function isTimerState(value: unknown): value is TimerState {
  return isState(value);
}

export class UnreadableTimerStateError extends Error {
  constructor() {
    super(t('timer.unreadableState'));
    this.name = 'UnreadableTimerStateError';
  }
}

/** A malformed state fails its request the way a failed request does. */
export function timerStateOf(value: unknown): TimerState {
  if (!isTimerState(value)) throw new UnreadableTimerStateError();
  return value;
}

interface TimerUpdate {
  state: TimerState;
  /** Null if the state's server time is unreadable. */
  offset: number | null;
  /** The state moved past a cached one, so entry lists are out of date. */
  changed: boolean;
}

/** Drops an older state (null), so a slow reply cannot undo a newer one; an equal one keeps the fresher clock. */
export function planTimerUpdate(
  cached: TimerState | undefined,
  incoming: TimerState,
  receivedAt: number,
): TimerUpdate | null {
  if (cached && incoming.revision < cached.revision) return null;
  return {
    state: incoming,
    offset: clockOffset(incoming.server_time, receivedAt),
    changed: cached !== undefined && incoming.revision > cached.revision,
  };
}

/** The state rides along to replace the stale one. Anything else is returned unchanged. */
export function explainTimerConflict(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409 && isTimerState(error.body)) {
    return new TimerActionError('conflict', error.body);
  }
  return error;
}

/** A 409 with a state is a conflict; no reply, or none within the deadline, is offline. Others pass unchanged. */
export function explainTimerActionError(error: unknown): unknown {
  if (error instanceof TypeError || error instanceof RequestTimeoutError) return new TimerActionError('offline');
  return explainTimerConflict(error);
}

/** No reply, a timeout, a 5xx (a proxy's may hide a run request) or an unreadable 2xx. A 4xx did nothing. */
export function isOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof RequestTimeoutError ||
    (error instanceof ApiError && error.status >= 500) ||
    error instanceof UnparsableReplyError ||
    error instanceof DecodeError ||
    error instanceof UnreadableTimerStateError
  );
}

const unknownTimers = new WeakSet<QueryClient>();

export function markTimerUnknown(qc: QueryClient): void {
  unknownTimers.add(qc);
}

export function isTimerUnknown(qc: QueryClient): boolean {
  return unknownTimers.has(qc);
}

export function clearTimerUnknown(qc: QueryClient): void {
  unknownTimers.delete(qc);
}

/**
 * Any entry write, an edit of what the running entry shows, or an import. Timer actions wait only for these;
 * the actions are not marked, so they never wait for themselves.
 */
export const MOVES_TIMER = { movesTimer: true } as const;

function isPendingTimerWrite(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return mutation.state.status === 'pending' && mutation.options.meta?.movesTimer === true;
}

/** A write also pauses while waiting its turn in a scope; that one goes out once the one before settles. */
function isHeldForConnection(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return mutation.state.isPaused && mutation.options.networkMode !== 'always' && !onlineManager.isOnline();
}

/** Returns whether it waited. A write held for the connection would hold the action, so the action fails offline. */
export function settleOtherWrites(qc: QueryClient): Promise<boolean> {
  const cache = qc.getMutationCache();
  const others = () => cache.getAll().filter(isPendingTimerWrite);
  const held = () => others().some(isHeldForConnection);
  if (held()) return Promise.reject(new TimerActionError('offline'));
  if (others().length === 0) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const unsubscribe = cache.subscribe(() => {
      if (held()) {
        unsubscribe();
        reject(new TimerActionError('offline'));
      } else if (others().length === 0) {
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/** Whatever else moved the revision. */
function sameSubject(a: TimerState, b: TimerState): boolean {
  return (
    a.pomodoro?.phase.start === b.pomodoro?.phase.start &&
    a.pause?.paused === b.pause?.paused &&
    a.pause?.clone_entry_id === b.pause?.clone_entry_id
  );
}

/** If the user's phase and pause are still the server's, only this tab's edit moved the revision; else a conflict. */
export function revisionToSend(seen: TimerState, fresh: TimerState): number {
  return sameSubject(seen, fresh) ? fresh.revision : seen.revision;
}
