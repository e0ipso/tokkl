/**
 * Wires timer state from commit to client: the domain's timer operations publish each committed
 * view, the ordered publication delivers it to this process's streams and signals the bus, and bus
 * signals from other processes refresh the streams from the database.
 */
import type { Storage } from '../domain/ports.ts';
import type { Id } from '../domain/model.ts';
import type { TimerBus } from '../storage/timerBus.ts';
import { createTimerOperations } from '../domain/timers.ts';
import { buildTimerView, type TimerView } from '../domain/timerView.ts';
import type { Logger } from '../lib/logger.ts';
import { presentTimerState } from '../presenters/timer.ts';
import { createTimerPublication, type OrderedTimerPublication } from './timerPublication.ts';
import { TimerStreams, type TimerStreamOptions } from './timerStreams.ts';

export interface TimerDeliveryOptions {
  storage: Storage;
  bus: TimerBus;
  logger: Logger;
  streamOptions?: TimerStreamOptions;
}

export function createTimerDelivery({ storage, bus, logger, streamOptions }: TimerDeliveryOptions) {
  // `timers` and `publish` are defined below; streams call these only after construction.
  const timerStreams = new TimerStreams(async id => presentTimerState(await timers.getTimerState(id)), {
    ...streamOptions,
    onBehind: (id, revision) => {
      publish.refresh(id, revision).catch(error => logger.error('Timer refresh failed', { error }));
    },
  });
  const ordered = createTimerPublication<TimerView>(
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
  const refreshes = new Set<Promise<void>>();
  // Every local commit publishes through here. Remote refreshes skip the send, which stops echo loops.
  const publish: OrderedTimerPublication<TimerView> = Object.assign(
    (id: Id, view: TimerView, incarnation: string) => {
      const delivery = ordered(id, view, incarnation);
      try {
        bus.send({ userId: id, revision: view.revision });
      } catch (error) {
        logger.warn('Timer bus send failed', { error });
      }
      return delivery;
    },
    {
      forgetUser: ordered.forgetUser,
      claim: ordered.claim,
      refresh(id: Id, hintedRevision: number) {
        const refresh = ordered.refresh(id, hintedRevision);
        refreshes.add(refresh);
        void refresh.then(
          () => refreshes.delete(refresh),
          () => refreshes.delete(refresh),
        );
        return refresh;
      },
    },
  );
  const timers = createTimerOperations(storage, publish);
  return {
    timerStreams,
    publish,
    timers,
    /** Waits for started refreshes; call after the streams closed, so no new one starts. */
    async settled(): Promise<void> {
      await Promise.allSettled([...refreshes]);
    },
  };
}
