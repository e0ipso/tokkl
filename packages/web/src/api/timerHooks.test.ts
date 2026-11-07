import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { keys, stale } from './keys.ts';
import { acceptTimerState } from './timerHooks.ts';
import type { TimerState } from './types.ts';

const state = (revision: number): TimerState => ({
  revision,
  server_time: '2026-10-27T10:00:00.000Z',
  running_entry: null,
  pause: null,
  pomodoro: null,
  discarded_pomodoro: null,
});

const derived: QueryKey[] = [keys.entries, keys.report, keys.trash, keys.projects, keys.tasks, keys.tags];
const projectTasks: QueryKey = [...keys.tasks, 'project', 4];

/** A client holding data under every key, so each one can be checked for invalidation. */
function seeded(): QueryClient {
  const qc = new QueryClient();
  for (const key of [...derived, projectTasks, keys.clients]) qc.setQueryData(key, []);
  qc.setQueryData(keys.timer, state(1));
  return qc;
}

const invalidated = (qc: QueryClient, key: QueryKey) => qc.getQueryState(key)?.isInvalidated ?? false;

test('entry writes and timer changes share one policy that covers project and task totals', () => {
  const writes = new Set<QueryKey>(stale.entries);
  const changes = new Set<QueryKey>(stale.timerChanged);
  for (const key of derived) {
    assert.ok(writes.has(key), `entry writes refresh ${String(key)}`);
    assert.ok(changes.has(key), `timer changes refresh ${String(key)}`);
  }
  // A timer state carries the running entry and itself, so only an entry write refetches them.
  assert.ok(writes.has(keys.current) && writes.has(keys.timer));
  assert.ok(!changes.has(keys.current) && !changes.has(keys.timer));
});

test('a state that moved on marks everything derived from entries stale, totals included', () => {
  const qc = seeded();
  acceptTimerState(qc, state(2));
  for (const key of derived) assert.equal(invalidated(qc, key), true, String(key));
  assert.equal(invalidated(qc, projectTasks), true);
  assert.equal(invalidated(qc, keys.clients), false);
  assert.equal(invalidated(qc, keys.timer), false);
});

test('a state at the cached revision or older marks nothing stale', () => {
  const qc = seeded();
  acceptTimerState(qc, state(1));
  acceptTimerState(qc, state(0));
  for (const key of derived) assert.equal(invalidated(qc, key), false, String(key));
});
