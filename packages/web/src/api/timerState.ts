import type { Mutation, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';
import { clockOffset } from './serverClock.ts';
import type { TimeEntry, TimerState } from './types.ts';

/** What the views show when another device changed the timer before this action reached the server. */
export const TIMER_CONFLICT_MESSAGE = 'Another device changed the timer first.';

/** What the views show when an action could not reach the server. */
export const TIMER_OFFLINE_MESSAGE = "Can't reach the server. Try again when you're back online.";

/** Why a timer action failed in a way the views explain: the timer moved on, or the server was unreachable. */
export class TimerActionError extends Error {
  readonly kind: 'conflict' | 'offline';
  /** The server's current state, for a conflict. */
  readonly state: TimerState | null;

  constructor(kind: 'conflict' | 'offline', state: TimerState | null = null) {
    super(kind === 'conflict' ? TIMER_CONFLICT_MESSAGE : TIMER_OFFLINE_MESSAGE);
    this.kind = kind;
    this.state = state;
  }
}

export function isTimerState(value: unknown): value is TimerState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.revision === 'number' && typeof candidate.server_time === 'string';
}

/** What to write into the caches for an arriving state. */
export interface TimerUpdate {
  state: TimerState;
  /** The running entry, for the current-entry cache. */
  current: TimeEntry | null;
  /** The clock offset taken at arrival, or null if the state's server time is unreadable. */
  offset: number | null;
  /** True when the state moved past a cached one, so lists built from entries are out of date. */
  changed: boolean;
}

/**
 * Decides what an arriving state changes. A state older than the cached one is dropped (null),
 * because a slow response or a replayed event must not undo a newer state. An equal revision is
 * kept: it carries a fresher server time.
 */
export function planTimerUpdate(cached: TimerState | undefined, incoming: TimerState, receivedAt: number): TimerUpdate | null {
  if (cached && incoming.revision < cached.revision) return null;
  return {
    state: incoming,
    current: incoming.running_entry,
    offset: clockOffset(incoming.server_time, receivedAt),
    changed: cached !== undefined && incoming.revision > cached.revision,
  };
}

/**
 * Turns a failed timer request into the error the views show. A 409 whose body is a timer state
 * is a conflict, and the state rides along so it can replace the stale one. A request that never
 * got a reply (fetch rejects with a TypeError) is offline. Anything else is returned unchanged.
 */
export function explainTimerActionError(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409 && isTimerState(error.body)) {
    return new TimerActionError('conflict', error.body);
  }
  if (error instanceof TypeError) return new TimerActionError('offline');
  return error;
}

/** The mutation key of every timer action, so waiting for other writes can leave them out. */
export const TIMER_ACTION_KEY = ['timerAction'] as const;

function isOtherWrite(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return mutation.state.status === 'pending' && mutation.options.mutationKey?.[0] !== TIMER_ACTION_KEY[0];
}

/**
 * Waits until no write other than a timer action is in flight, and says whether it had to wait. An
 * edit of the running entry moves the revision, so an action that reads the revision while that
 * edit is pending would send a stale one and conflict with this tab's own edit. A write held until
 * the browser is back online would release the action only then, so the action fails at once with
 * a `TimerActionError` of kind `offline`, as one sent without a connection does.
 */
export function settleOtherWrites(qc: QueryClient): Promise<boolean> {
  const cache = qc.getMutationCache();
  const others = () => cache.getAll().filter(isOtherWrite);
  const held = () => others().some((mutation) => mutation.state.isPaused);
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

/** Whether two states show the same session phase and the same pause, whatever else moved the revision. */
function sameSubject(a: TimerState, b: TimerState): boolean {
  return a.pomodoro?.phase.start === b.pomodoro?.phase.start
    && a.pause?.paused === b.pause?.paused && a.pause?.clone_entry_id === b.pause?.clone_entry_id;
}

/**
 * The revision an action sends after waiting for this tab's own edit. If the phase and pause the
 * user saw are still the server's, only the edit moved the revision, so the action goes out at the
 * new one. Otherwise it keeps the revision the user saw and the server answers with a conflict.
 */
export function revisionToSend(seen: TimerState, fresh: TimerState): number {
  return sameSubject(seen, fresh) ? fresh.revision : seen.revision;
}
