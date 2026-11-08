import { ApiError } from './client.ts';
import { DecodeError } from './decode.ts';
import { TimerActionError, UnreadableTimerStateError, explainTimerActionError } from './timerState.ts';
import type { TimerState } from './types.ts';

/**
 * Start, Continue and Stop are v9 entry writes, and like the timer actions they are tried at once.
 * One that got no reply, a 5xx or a reply that cannot be read may still have been saved: the timer
 * is then unknown until the next read of its state, and a start in the meantime could add a second
 * entry or replace one the user never saw. This tracks that, so the timer bar reads the state
 * before the next start.
 */

/**
 * Start, Continue and Stop run even while the browser reports being offline, like the timer
 * actions in timerHooks.ts. TanStack's default would hold them until the connection returns and
 * then send a start with the time of the click; they fail at once instead, with the offline message.
 */
export const TIMER_ENTRY_OPTIONS = { networkMode: 'always' } as const;

/**
 * Whether a failed write leaves the timer unknown, because the server may have saved it:
 * - it got no reply, or none within its deadline (the offline `TimerActionError`);
 * - the server answered with a 5xx, which a proxy or a crash can send after the write committed;
 * - the server answered 2xx with a body that is not JSON (`SyntaxError` from `request`), does not
 *   fit its decoder (`DecodeError`) or is not a whole timer state (`UnreadableTimerStateError`).
 * A conflict and any other 4xx are answers: the server refused the write.
 */
export function isUncertain(error: unknown): boolean {
  if (error instanceof TimerActionError) return error.kind === 'offline';
  if (error instanceof ApiError) return error.status >= 500;
  return error instanceof SyntaxError || error instanceof DecodeError || error instanceof UnreadableTimerStateError;
}

/**
 * Runs a write or read that starts, stops or checks the timer. A request that got no reply fails
 * with the offline `TimerActionError`, as a timer action does; other failures pass through.
 */
export async function attemptTimerRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw explainTimerActionError(error);
  }
}

export interface TimerOutcome {
  /** Notes a failed timer write. One that may have been saved leaves the timer unknown. */
  failed(error: unknown): void;
  /**
   * Whether a start may go out, given the id of the running entry the user saw (null for none).
   * While the timer is unknown it reads the state first, and the start goes out only if the server
   * runs the entry the user saw; otherwise the views catch up with the read and the user decides
   * again. A read that fails throws, so the start fails the same way and the timer stays unknown.
   */
  mayStart(seenRunningId: number | null): Promise<boolean>;
}

/** Tracks one account's timer outcome. `read` fetches the timer state and writes it into the caches. */
export function createTimerOutcome(read: () => Promise<TimerState>): TimerOutcome {
  let unknown = false;
  return {
    failed(error) {
      if (isUncertain(error)) unknown = true;
    },
    async mayStart(seenRunningId) {
      if (!unknown) return true;
      const state = await attemptTimerRequest(read);
      unknown = false;
      return (state.running_entry?.id ?? null) === seenRunningId;
    },
  };
}
