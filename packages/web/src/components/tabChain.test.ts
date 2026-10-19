import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainKey, serializeChain, type PauseChain } from './pauseChain.ts';
import { readTabChain, subscribeTabChain, writeTabChain } from './tabChain.ts';

// The tab's chain sits on window.localStorage, which a minimal window stands in for. `mode` blocks
// storage the way browsers do: `blocked` throws on any access, `full` reads but refuses writes.
const storage = new Map<string, string>();
let mode: 'open' | 'blocked' | 'full' = 'open';
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (mode === 'full') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    storage.set(key, value);
  },
  removeItem: (key: string) => void storage.delete(key),
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};
Object.assign(globalThis, {
  window: {
    get localStorage() {
      if (mode === 'blocked') throw new DOMException('The operation is insecure.', 'SecurityError');
      return localStorage;
    },
  },
});

function chain(stoppedSeconds: number, runningId: number | null = null): PauseChain {
  return {
    stoppedSeconds, runningId, since: 1_000 + stoppedSeconds,
    snapshot: { description: 'Write the spec', project_id: 4, task_id: null, tags: ['docs'], billable: false },
  };
}

/** Records every write this tab's listeners hear until `stop` is called. */
function listen() {
  const heard: [number, PauseChain | null][] = [];
  const stop = subscribeTabChain((accountId, written) => void heard.push([accountId, written]));
  return { heard, stop };
}

function reset() {
  mode = 'open';
  storage.clear();
}

test('a write is stored under the account key, read back and heard by every listener', () => {
  reset();
  const first = listen();
  const second = listen();
  const paused = chain(600);
  writeTabChain(7, paused);
  assert.equal(storage.get(chainKey(7)), serializeChain(paused));
  assert.deepEqual(readTabChain(7), paused);
  assert.deepEqual(first.heard, [[7, paused]]);
  assert.deepEqual(second.heard, [[7, paused]]);

  first.stop();
  writeTabChain(7, null);
  assert.equal(storage.has(chainKey(7)), false, 'null removes the stored chain');
  assert.equal(readTabChain(7), null);
  assert.deepEqual(first.heard, [[7, paused]], 'an unsubscribed listener hears nothing more');
  assert.deepEqual(second.heard, [[7, paused], [7, null]]);
  second.stop();
});

test('accounts on one browser never see each other’s chain', () => {
  reset();
  const { heard, stop } = listen();
  writeTabChain(7, chain(600));
  assert.equal(readTabChain(8), null);
  writeTabChain(8, chain(60));
  assert.equal(readTabChain(7)?.stoppedSeconds, 600);
  assert.deepEqual(heard.map(([accountId]) => accountId), [7, 8], 'listeners get the account with each write');
  stop();
});

test('without an account nothing is read, stored or heard', () => {
  reset();
  const { heard, stop } = listen();
  writeTabChain(0, chain(600));
  assert.equal(storage.size, 0);
  assert.equal(readTabChain(0), null);
  assert.deepEqual(heard, []);
  stop();
});

test('another tab’s write, read from storage, wins over the last write here', () => {
  reset();
  writeTabChain(7, chain(600));
  const theirs = chain(900, 12);
  storage.set(chainKey(7), serializeChain(theirs));
  assert.deepEqual(readTabChain(7), theirs);
  storage.delete(chainKey(7));
  assert.equal(readTabChain(7), null, 'another tab’s Stop ends the chain here too');
});

test('an unreadable stored chain counts as none', () => {
  reset();
  storage.set(chainKey(7), '{"v":1,"stoppedSeconds":"many"}');
  assert.equal(readTabChain(7), null);
});

test('with storage blocked, the last chain written in this tab stands in for its account', () => {
  reset();
  mode = 'blocked';
  const { heard, stop } = listen();
  const paused = chain(600);
  writeTabChain(7, paused);
  assert.deepEqual(heard, [[7, paused]], 'listeners still hear the write');
  assert.deepEqual(readTabChain(7), paused);
  assert.equal(readTabChain(8), null, 'the chain kept in memory is only its own account’s');

  writeTabChain(7, null);
  assert.equal(readTabChain(7), null);
  mode = 'open';
  assert.equal(storage.size, 0, 'nothing reached storage');
  stop();
});

test('a write that storage refuses still reaches this tab’s listeners', () => {
  reset();
  mode = 'full';
  const { heard, stop } = listen();
  const paused = chain(600);
  writeTabChain(7, paused);
  assert.deepEqual(heard, [[7, paused]]);
  assert.equal(storage.size, 0);
  stop();
});

test('with writes refused, reads return the chain last written until a write succeeds', () => {
  reset();
  const running = chain(600, 12);
  writeTabChain(7, running);
  assert.deepEqual(readTabChain(7), running);

  mode = 'full';
  const paused = chain(900);
  writeTabChain(7, paused);
  assert.equal(storage.get(chainKey(7)), serializeChain(running), 'storage kept the earlier chain');
  assert.deepEqual(readTabChain(7), paused, 'reads return the refused write, not the stored chain');

  const resumed = chain(900, 13);
  writeTabChain(7, resumed);
  assert.deepEqual(readTabChain(7), resumed, 'each refused write replaces the one before');

  mode = 'open';
  const stored = chain(1200);
  writeTabChain(7, stored);
  assert.equal(storage.get(chainKey(7)), serializeChain(stored));
  assert.deepEqual(readTabChain(7), stored);
  const theirs = chain(1500, 14);
  storage.set(chainKey(7), serializeChain(theirs));
  assert.deepEqual(readTabChain(7), theirs, 'once a write succeeds, reads follow storage again');
});

test('a removal storage accepts under a full quota ends the refused chain', () => {
  reset();
  writeTabChain(7, chain(600, 12));
  mode = 'full';
  writeTabChain(7, chain(900));
  writeTabChain(7, null);
  assert.equal(storage.has(chainKey(7)), false);
  assert.equal(readTabChain(7), null);
  const theirs = chain(1500, 14);
  storage.set(chainKey(7), serializeChain(theirs));
  assert.deepEqual(readTabChain(7), theirs, 'reads follow storage, not the refused chain');
});

test('with writes refused, only the written account reads from memory', () => {
  reset();
  const theirs = chain(60);
  storage.set(chainKey(8), serializeChain(theirs));
  mode = 'full';
  const paused = chain(600);
  writeTabChain(7, paused);
  assert.deepEqual(readTabChain(7), paused);
  assert.deepEqual(readTabChain(8), theirs, 'another account reads its stored chain');
});

test('with writes refused, a change another tab makes to storage wins over the refused write', () => {
  reset();
  writeTabChain(7, chain(600, 12));
  mode = 'full';
  const paused = chain(900);
  writeTabChain(7, paused);
  assert.deepEqual(readTabChain(7), paused);

  storage.delete(chainKey(7));
  assert.equal(readTabChain(7), null, 'another tab’s Stop ends the chain here too');

  const theirs = chain(1500, 14);
  storage.set(chainKey(7), serializeChain(theirs));
  assert.deepEqual(readTabChain(7), theirs, 'another tab’s write is read from storage');
});

test('with writes refused and no chain stored, the refused chain is still read back', () => {
  reset();
  mode = 'full';
  const paused = chain(600);
  writeTabChain(7, paused);
  assert.equal(storage.size, 0);
  assert.deepEqual(readTabChain(7), paused);
});
