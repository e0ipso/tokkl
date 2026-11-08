/**
 * Process-local ordering of committed timer states. The domain hands each committed state to a
 * `TimerPublication`; this module turns that into per-user, revision-ordered delivery.
 */
import type { Id } from '../domain/model.ts';
import type { TimerView } from '../domain/timerView.ts';

/** What publication orders: anything that carries the revision it was built at. */
export interface Revisioned {
  revision: number;
}
export type TimerDelivery<S extends Revisioned> = (userId: Id, state: S) => Promise<void>;
/** Reads committed state for a signalled user. `rebuild` must only read: no settling, no commit. */
export interface RemoteTimerSource<S extends Revisioned> {
  hasStreams(userId: Id): boolean;
  rebuild(userId: Id): Promise<{ state: S; incarnation: string } | undefined>;
}
export type OrderedTimerPublication<S extends Revisioned> = ((
  userId: Id,
  state: S,
  incarnation: string,
) => Promise<void>) & {
  /** Drops what this process holds for a deleted account. */
  forgetUser(userId: Id): void;
  /** Delivers the database's state when it is newer than what this process delivered. Never signals. */
  refresh(userId: Id, hintedRevision: number): Promise<void>;
  /** A stream opens for this incarnation. State held for another one is forgotten first, because
   * that account was deleted by another process. */
  claim(userId: Id, incarnation: string): void;
};

/** Serialize deliveries per user after release. Drop overtaken revisions; a failed delivery is
 * reported by the runner and never retried as a write. Later deliveries still run. Every delivery
 * must belong to the incarnation this process holds state for; any other is dropped. */
export function createTimerPublication<S extends Revisioned = TimerView>(
  deliver: TimerDelivery<S>,
  forgotten: (userId: Id) => void = () => {},
  remote?: RemoteTimerSource<S>,
): OrderedTimerPublication<S> {
  const queues = new Map<Id, Promise<void>>(),
    delivered = new Map<Id, number>();
  const generations = new Map<Id, object>(),
    incarnations = new Map<Id, string>();
  const behind = (id: Id, revision: number) => revision > (delivered.get(id) ?? -1);
  // An id with no state yet takes the first incarnation seen, so `delivered` always has an owner.
  function owns(id: Id, incarnation: string): boolean {
    const known = incarnations.get(id);
    if (known === undefined) incarnations.set(id, incarnation);
    return known === undefined || known === incarnation;
  }
  async function enqueue(id: Id, work: (current: () => boolean) => Promise<void>): Promise<void> {
    // Captured before any await, so a deletion while this waits or builds discards the result.
    let generation = generations.get(id);
    if (!generation) {
      generation = {};
      generations.set(id, generation);
    }
    const current = () => generations.get(id) === generation;
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(() => work(current));
    queues.set(id, next);
    try {
      await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  async function send(id: Id, state: S) {
    delivered.set(id, state.revision);
    await deliver(id, structuredClone(state));
  }
  function forgetUser(id: Id) {
    generations.delete(id);
    delivered.delete(id);
    incarnations.delete(id);
    forgotten(id);
  }
  return Object.assign(
    (id: Id, state: S, incarnation: string) =>
      enqueue(id, async current => {
        if (current() && owns(id, incarnation) && behind(id, state.revision)) await send(id, state);
      }),
    {
      forgetUser,
      claim(id: Id, incarnation: string) {
        const known = incarnations.get(id);
        if (known !== undefined && known !== incarnation) forgetUser(id);
        incarnations.set(id, incarnation);
      },
      refresh(id: Id, hint: number): Promise<void> {
        if (!remote?.hasStreams(id) || !behind(id, hint)) return Promise.resolve();
        return enqueue(id, async current => {
          if (!current() || !behind(id, hint) || !remote.hasStreams(id)) return;
          const rebuilt = await remote.rebuild(id);
          if (rebuilt && current() && owns(id, rebuilt.incarnation) && behind(id, rebuilt.state.revision))
            await send(id, rebuilt.state);
        });
      },
    },
  );
}
