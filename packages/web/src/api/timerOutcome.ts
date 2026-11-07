import { TimerActionError, explainTimerActionError } from './timerState.ts';
import type { TimerState } from './types.ts';

/**
 * Start, Continue and Stop are v9 entry writes, and like the timer actions they are tried at once.
 * One that got no reply may still have reached the server: the timer is then unknown until the
 * next read of its state, and a start in the meantime could add a second entry or replace one the
 * user never saw. This tracks that, so the timer bar reads the state before the next start.
 */

/**
 * Start, Continue and Stop run even while the browser reports being offline, like the timer
 * actions in timerHooks.ts. TanStack's default would hold them until the connection returns and
 * then send a start with the time of the click; they fail at once instead, with the offline message.
 */
export const TIMER_ENTRY_OPTIONS = { networkMode: 'always' } as const;

/** Whether a failed write leaves the timer unknown: it got no reply, so the server may have saved it. */
export function isUncertain(error: unknown): boolean {
  return error instanceof TimerActionError && error.kind === 'offline';
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
  /** Notes a failed Start, Continue or Stop. One that got no reply leaves the timer unknown. */
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
