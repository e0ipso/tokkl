import type { Db } from '../db/index.ts';

/** Called after a committed change to one user's timer state. */
export type TimerListener = () => void;

/** Listeners per user, per database. The server runs as one process, so no broker is needed. */
const hubs = new WeakMap<Db, Map<number, Set<TimerListener>>>();

/**
 * Calls `listener` after each committed change to `userId`'s timer state in `db`: the running
 * entry, the Pomodoro session or the pause chain. Listeners run synchronously, right after the
 * commit and outside the transaction, so they may read or start a transaction of their own.
 * Returns the function that unsubscribes the listener.
 */
export function subscribeTimer(db: Db, userId: number, listener: TimerListener): () => void {
  const users = hubs.get(db) ?? new Map<number, Set<TimerListener>>();
  hubs.set(db, users);
  const listeners = users.get(userId) ?? new Set<TimerListener>();
  users.set(userId, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && users.get(userId) === listeners) users.delete(userId);
  };
}

/**
 * Calls every listener `userId` has in `db`. A listener that throws is logged and the others still
 * run, so a broken subscriber never reaches the write that published.
 */
export function publishTimer(db: Db, userId: number): void {
  const listeners = hubs.get(db)?.get(userId);
  if (!listeners) return;
  // A copy, so listeners that subscribe or unsubscribe during the call do not change who hears it.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  }
}
