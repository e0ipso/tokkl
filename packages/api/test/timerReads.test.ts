import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageFor } from './fixtures/database.ts';
import { createTimerOperations, type TimerRunner } from '../src/domain/timers.ts';
import type { EntryRepositories } from '../src/domain/entryAccess.ts';
import type { TimerView } from '../src/domain/timerView.ts';
import { setup } from './helpers.ts';
import { at, manualClock } from './fixtures/clock.ts';

function countedTimers(db: Parameters<typeof storageFor>[0], user: { id: number }) {
  const storage = storageFor(db);
  const published: TimerView[] = [];
  let writes = 0;
  const runner: TimerRunner<EntryRepositories> = {
    transaction: work => {
      writes++;
      return storage.transaction(work);
    },
    readSnapshot: work => storage.readSnapshot(work),
  };
  const clock = manualClock(at('00:00:00'));
  const timers = createTimerOperations(
    runner,
    user,
    async (_id, view) => {
      published.push(view);
    },
    clock,
  );
  return { timers, clock, storage, published, writes: () => writes };
}

test('a settled timer is read without a write transaction and answers what the write path answers', async () => {
  const ctx = await setup();
  const { timers, clock, writes, published } = countedTimers(ctx.db, ctx.user);

  clock.set(at('08:00:00'));
  const idle = await timers.getTimerState();
  assert.equal(idle.revision, 0);
  assert.equal(idle.running, null);
  assert.equal(writes(), 0, 'an idle timer with no revision yet needs no settling');

  clock.set(at('09:00:00'));
  const started = await timers.startTimer({
    revision: 0,
    entry: { description: 'read me', tagIds: [], billable: false, createdWith: 'test' },
  });
  assert.equal(writes(), 1);
  assert.equal(published.length, 1);

  clock.set(at('09:00:00'));
  const read = await timers.getTimerState();
  assert.equal(writes(), 1, 'a settled read opens no write transaction');
  assert.equal(published.length, 1, 'a settled read publishes nothing');
  assert.deepEqual(read, started);
  assert.ok(Object.isFrozen(read));
});

test('a read that finds the timer unsettled settles it on the write path and numbers a new revision', async () => {
  const ctx = await setup();
  const { timers, clock, storage, writes, published } = countedTimers(ctx.db, ctx.user);
  clock.set(at('09:00:00'));
  const started = await timers.startTimer({
    revision: 0,
    entry: { description: 'pomodoro', tagIds: [], billable: false, createdWith: 'test' },
  });
  // A session written without settling: the stored revision does not show it yet.
  await storage.timers.saveSession({
    userId: ctx.user.id,
    entryId: started.running!.id,
    config: { workMinutes: 25, shortRestMinutes: 5, longRestMinutes: 15, longRestEvery: 4 },
    phase: { kind: 'work', startedAt: at('09:00:00').toISOString(), completed: 0 },
  });
  const before = writes();

  clock.set(at('09:01:00'));
  const settled = await timers.getTimerState();
  assert.equal(writes(), before + 1, 'the unsettled read takes the write path');
  assert.equal(settled.revision, started.revision + 1);
  assert.equal(settled.pomodoro?.entryId, started.running!.id);
  assert.equal(published.at(-1)?.revision, settled.revision);

  clock.set(at('09:01:00'));
  const again = await timers.getTimerState();
  assert.equal(writes(), before + 1, 'once settled, reads stay read-only');
  assert.deepEqual(again, settled);
});

test('a read whose running entry lost its session settles it on the write path', async () => {
  const ctx = await setup();
  const { timers, clock, storage, writes } = countedTimers(ctx.db, ctx.user);
  clock.set(at('09:00:00'));
  const session = await timers.startPomodoro({
    lengths: {},
    entry: { description: 'focus', tagIds: [], billable: false, createdWith: 'test' },
  });
  const stored = await storage.timers.getSession(ctx.user.id);
  await storage.timers.saveSession({ ...stored!, entryId: session.running!.id + 1000 });
  const before = writes();
  clock.set(at('09:05:00'));
  const state = await timers.getTimerState();
  assert.equal(writes(), before + 1);
  assert.equal(state.pomodoro, null);
  assert.equal(state.revision, session.revision + 1);
});
