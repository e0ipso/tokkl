/** Publishing returns at once, so a reply may beat its stream event; revisions make that harmless. */
import type { TimerState } from '@tokkl/types';
import type { AccountRepositories, AccountRunner } from '../domain/accountGuards.ts';
import { credentialHolds, type Authentication } from '../domain/credentials.ts';
import type { Id } from '../domain/model.ts';
import type { Clock, Storage, TimerBus } from '../domain/ports.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import { createTimerOperations, TimerRefusal, type TimerOperations } from '../domain/timers.ts';
import { buildTimerView, type TimerView } from '../domain/timerView.ts';
import { sha256 } from '../lib/crypto.ts';
import { StateConflict } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { presentTimerState } from '../presenters/timer.ts';
import { TimerStreams, type StreamCredentialResult, type TimerStreamLimits } from './timerStreams.ts';

/** `rebuild` must only read: no settling, no commit. */
interface RemoteTimerSource {
  hasStreams(userId: Id): boolean;
  rebuild(userId: Id): Promise<{ state: TimerView; incarnation: string } | undefined>;
}

/** Serializes per user, dropping overtaken revisions and other incarnations. A failed delivery rejects its caller. */
export function createTimerPublication(
  deliver: (userId: Id, view: TimerView) => Promise<void>,
  forgotten: (userId: Id) => void = () => {},
  remote?: RemoteTimerSource,
) {
  const queues = new Map<Id, Promise<void>>();
  const delivered = new Map<Id, number>();
  const generations = new Map<Id, object>();
  const incarnations = new Map<Id, string>();
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
    if (!generation) generations.set(id, (generation = {}));
    const current = () => generations.get(id) === generation;
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(() => work(current));
    queues.set(id, next);
    try {
      await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  async function send(id: Id, view: TimerView) {
    delivered.set(id, view.revision);
    await deliver(id, structuredClone(view));
  }
  function forgetUser(id: Id) {
    generations.delete(id);
    delivered.delete(id);
    incarnations.delete(id);
    forgotten(id);
  }
  return {
    publish: (id: Id, view: TimerView, incarnation: string) =>
      enqueue(id, async current => {
        if (current() && owns(id, incarnation) && behind(id, view.revision)) await send(id, view);
      }),
    forgetUser,
    /** State held for another incarnation (a deleted account) goes first. */
    claim(id: Id, incarnation: string) {
      const known = incarnations.get(id);
      if (known !== undefined && known !== incarnation) forgetUser(id);
      incarnations.set(id, incarnation);
    },
    /** Only when newer than what this process delivered. Never signals. */
    refresh(id: Id, hint: number): Promise<void> {
      if (!remote?.hasStreams(id) || !behind(id, hint)) return Promise.resolve();
      return enqueue(id, async current => {
        if (!current() || !behind(id, hint) || !remote.hasStreams(id)) return;
        const rebuilt = await remote.rebuild(id);
        if (rebuilt && current() && owns(id, rebuilt.incarnation) && behind(id, rebuilt.state.revision))
          await send(id, rebuilt.state);
      });
    },
  };
}

interface TimerDeliveryOptions {
  storage: Storage;
  bus: TimerBus;
  clock: Clock;
  logger: Logger;
  streamLimits: Readonly<TimerStreamLimits>;
}

/** Local commits go to local streams in order and signal the bus; bus signals refresh from the database. */
export function createTimerDelivery({ storage, bus, clock, logger, streamLimits }: TimerDeliveryOptions) {
  const timerStreams = new TimerStreams(
    async id => presentTimerState(await createTimerOperations(storage, { id }, publish, clock).getTimerState()),
    { ...streamLimits, onBehind: (id, revision) => refreshLogged(id, revision) },
  );
  const ordered = createTimerPublication(
    async (id, view) => {
      // A failed delivery must not fail the commit that caused it; the next state supersedes it.
      await timerStreams
        .publish(id, presentTimerState(view))
        .catch(error => logger.error('Timer delivery failed', { error }));
    },
    id => timerStreams.forgetUser(id),
    {
      hasStreams: id => timerStreams.hasStreams(id),
      // Read-only on purpose: settling here would commit a new revision and signal it back.
      rebuild: id =>
        storage.readSnapshot(async repositories => {
          const user = await repositories.users.get(id);
          return user ? { state: await buildTimerView(repositories, user), incarnation: user.createdAt } : undefined;
        }),
    },
  );
  const running = new Set<Promise<void>>();
  const track = (work: Promise<void>) => {
    running.add(work);
    const done = () => running.delete(work);
    void work.then(done, done);
    return work;
  };
  const refresh = (id: Id, hint: number) => track(ordered.refresh(id, hint));
  const refreshLogged = (id: Id, hint: number) =>
    void refresh(id, hint).catch(error => logger.error('Timer refresh failed', { error }));
  // Every local commit publishes here. Remote refreshes skip the bus, which stops echo loops.
  const publish: TimerPublication = async (id, view, incarnation) => {
    // Enqueued before this returns, so deliveries run in the order the commits published them.
    track(ordered.publish(id, view, incarnation)).catch(error => logger.error('Timer delivery failed', { error }));
    try {
      bus.send({ userId: id, revision: view.revision });
    } catch (error) {
      logger.warn('Timer bus send failed', { error });
    }
  };
  bus.receive(signal => refreshLogged(signal.userId, signal.revision));
  return {
    timerStreams,
    push: { ...ordered, publish, refresh },
    /** Includes those started while it waits. */
    async settled(): Promise<void> {
      while (running.size) await Promise.allSettled([...running]);
    },
  };
}

export type PresentedTimerOperations = {
  [Name in keyof TimerOperations]: (...args: Parameters<TimerOperations[Name]>) => Promise<TimerState>;
};

/** One that did not would fail to compile here. */
type ViewOperations = { [Name in keyof TimerOperations]: (...args: never[]) => Promise<TimerView> };

export function presentTimerOperations(operations: TimerOperations): PresentedTimerOperations {
  const views: ViewOperations = operations;
  const wrapped = {} as Record<keyof TimerOperations, (...args: never[]) => Promise<TimerState>>;
  for (const name of Object.keys(views) as Array<keyof TimerOperations>)
    wrapped[name] = async (...args) => {
      try {
        return presentTimerState(await views[name](...args));
      } catch (error) {
        if (error instanceof TimerRefusal) throw new StateConflict(error.message, presentTimerState(error.state));
        throw error;
      }
    };
  return wrapped as PresentedTimerOperations;
}

/** Storage failures fail closed and never reject the check. */
export function credentialCheck<R extends AccountRepositories>(
  runner: AccountRunner<R>,
  auth: Authentication,
): () => Promise<StreamCredentialResult> {
  // Capture fingerprints now, even if HTTP locals are replaced after a profile update.
  const observed = { ...auth, user: { ...auth.user }, credential: { ...auth.credential } };
  return async () => {
    try {
      return await runner.readSnapshot(async ctx => {
        const current = await ctx.users.getWithTimerRevision(observed.user.id);
        return current && (await credentialHolds(ctx, observed.user, observed.credential, current.user))
          ? { valid: true, revision: current.timerRevision }
          : { valid: false };
      });
    } catch {
      return { valid: false };
    }
  };
}

/** Streams that share it share each check. */
export function credentialKey(auth: Authentication): string {
  const { user, credential } = auth;
  const presented = credential.kind === 'password' ? user.apiToken : credential.token;
  return sha256(JSON.stringify([user.id, user.passwordHash, credential.kind, presented]));
}
