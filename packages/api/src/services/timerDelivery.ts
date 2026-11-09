/**
 * Wires timer state from commit to client: the domain's timer operations publish each committed
 * view, the ordered publication delivers it to this process's streams and signals the bus, and bus
 * signals from other processes refresh the streams from the database.
 *
 * Publishing starts the delivery and returns at once, so a write's reply never waits for stream
 * credential checks or a keep-alive tick holding the user's stream queue. The reply can then reach
 * its client before the stream sends the same state, or an older one still queued. Revisions keep
 * that harmless: each stream only ever sends a revision above the last one it sent, and clients
 * drop a state older than the one they hold (`planTimerUpdate` in the web client,
 * `TimerStateClient::adopt` in the desktop core).
 */
import type { Clock, Storage, TimerBus } from '../domain/ports.ts';
import type { Id } from '../domain/model.ts';
import { createTimerOperations } from '../domain/timers.ts';
import { buildTimerView, type TimerView } from '../domain/timerView.ts';
import type { Logger } from '../lib/logger.ts';
import { presentTimerState } from '../presenters/timer.ts';
import { createTimerPublication, type OrderedTimerPublication } from './timerPublication.ts';
import { TimerStreams, type TimerStreamOptions } from './timerStreams.ts';

export interface TimerDeliveryOptions {
  storage: Storage;
  bus: TimerBus;
  /** Where the state a stream opens with reads the time. */
  clock: Clock;
  logger: Logger;
  streamOptions?: TimerStreamOptions;
}

export function createTimerDelivery({ storage, bus, clock, logger, streamOptions }: TimerDeliveryOptions) {
  // `publish` is defined below; streams call it only after construction.
  const timerStreams = new TimerStreams(
    async id => presentTimerState(await createTimerOperations(storage, { id }, publish, clock).getTimerState()),
    {
      ...streamOptions,
      onBehind: (id, revision) => {
        publish.refresh(id, revision).catch(error => logger.error('Timer refresh failed', { error }));
      },
    },
  );
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
  /** Started deliveries and refreshes, until each ends. */
  const running = new Set<Promise<void>>();
  const track = (work: Promise<void>) => {
    running.add(work);
    void work.then(
      () => running.delete(work),
      () => running.delete(work),
    );
    return work;
  };
  // Every local commit publishes through here. Remote refreshes skip the send, which stops echo loops.
  const publish: OrderedTimerPublication<TimerView> = Object.assign(
    async (id: Id, view: TimerView, incarnation: string) => {
      // Enqueued before this returns, so deliveries run in the order the commits published them.
      track(ordered(id, view, incarnation)).catch(error => logger.error('Timer delivery failed', { error }));
      try {
        bus.send({ userId: id, revision: view.revision });
      } catch (error) {
        logger.warn('Timer bus send failed', { error });
      }
    },
    {
      forgetUser: ordered.forgetUser,
      claim: ordered.claim,
      refresh: (id: Id, hintedRevision: number) => track(ordered.refresh(id, hintedRevision)),
    },
  );
  bus.receive(signal => {
    publish.refresh(signal.userId, signal.revision).catch(error => logger.error('Timer refresh failed', { error }));
  });
  return {
    timerStreams,
    publish,
    /** Waits until no delivery or refresh is running, those started while it waits included. */
    async settled(): Promise<void> {
      while (running.size) await Promise.allSettled([...running]);
    },
  };
}
