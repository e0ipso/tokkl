import type { Mutation, QueryClient } from '@tanstack/react-query';
import { ApiError, RequestTimeoutError } from './client.ts';
import { DecodeError } from './decode.ts';
import { timerStateReply } from './replies.ts';
import { clockOffset } from './serverClock.ts';
import type { TimerState } from './types.ts';
import { t } from '../i18n/messages.ts';

/** What the views show when another device changed the timer before this action reached the server. */
export const TIMER_CONFLICT_MESSAGE = t('timer.conflict');

/** What the views show when an action could not reach the server. */
export const TIMER_OFFLINE_MESSAGE = t('timer.offline');

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

/** A 2xx reply whose body is not a whole timer state. The server may still have applied the action. */
export class UnreadableTimerStateError extends Error {
  constructor() {
    super(t('timer.unreadableState'));
    this.name = 'UnreadableTimerStateError';
  }
}

/**
 * Whether `value` is a whole timer state: the revision and server time, and the running entry,
 * pause chain, session and discarded pomodoro each null or of their full shape.
 */
export function isTimerState(value: unknown): value is TimerState {
  try {
    timerStateReply(value);
    return true;
  } catch (error) {
    if (error instanceof DecodeError) return false;
    throw error;
  }
}

/**
 * Decodes a timer state reply, failing when the server sent something else, so a malformed state
 * fails its request the way a failed request does.
 */
export function timerStateOf(value: unknown): TimerState {
  if (!isTimerState(value)) throw new UnreadableTimerStateError();
  return value;
}

/** What to write into the caches for an arriving state. */
export interface TimerUpdate {
  state: TimerState;
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

/**
 * Turns a failed timer request into the error the views show. A 409 whose body is a timer state
 * is a conflict, and the state rides along so it can replace the stale one. A request that never
 * got a reply (fetch rejects with a TypeError) is offline, and so is one that got none within its
 * deadline: either may have reached the server, so both leave the timer unknown until the next
 * read of its state. Anything else is returned unchanged.
 */
export function explainTimerActionError(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 409 && isTimerState(error.body)) {
    return new TimerActionError('conflict', error.body);
  }
  if (error instanceof TypeError || error instanceof RequestTimeoutError) return new TimerActionError('offline');
  return error;
}

/**
 * Mutation meta for a write that can move the timer revision: any entry write, and an edit of what
 * the running entry shows (its project, client, task or tags) or an import. Timer actions wait for
 * these writes and for no others, so a preference, profile or admin save never holds one up.
 * Timer actions themselves are not marked, so an action never waits for itself.
 */
export const MOVES_TIMER = { movesTimer: true } as const;

function isPendingTimerWrite(mutation: Mutation<unknown, Error, unknown, unknown>): boolean {
  return mutation.state.status === 'pending' && mutation.options.meta?.movesTimer === true;
}

/**
 * Waits until no write marked `MOVES_TIMER` is in flight, and says whether it had to wait. An edit
 * of the running entry moves the revision, so an action that reads the revision while that edit is
 * pending would send a stale one and conflict with this tab's own edit. Such a write held until the
 * browser is back online would release the action only then, so the action fails at once with a
 * `TimerActionError` of kind `offline`, as one sent without a connection does.
 */
export function settleOtherWrites(qc: QueryClient): Promise<boolean> {
  const cache = qc.getMutationCache();
  const others = () => cache.getAll().filter(isPendingTimerWrite);
  const held = () => others().some(mutation => mutation.state.isPaused);
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
  return (
    a.pomodoro?.phase.start === b.pomodoro?.phase.start &&
    a.pause?.paused === b.pause?.paused &&
    a.pause?.clone_entry_id === b.pause?.clone_entry_id
  );
}

/**
 * The revision an action sends after waiting for this tab's own edit. If the phase and pause the
 * user saw are still the server's, only the edit moved the revision, so the action goes out at the
 * new one. Otherwise it keeps the revision the user saw and the server answers with a conflict.
 */
export function revisionToSend(seen: TimerState, fresh: TimerState): number {
  return sameSubject(seen, fresh) ? fresh.revision : seen.revision;
}
