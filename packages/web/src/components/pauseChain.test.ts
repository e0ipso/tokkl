import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chainKey, chainSeconds, forgetChains, isPaused, loadChain, parseChain, pause, reconcile, resume, sameSnapshot, saveChain,
  serializeChain, withSnapshot, type ChainEntry, type ChainStorage, type PauseChain,
} from './pauseChain.ts';

const T0 = Date.parse('2026-10-19T10:00:00Z');
const minutes = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function entry(id: number, startMs: number, stopMs: number | null, extra: Partial<ChainEntry> = {}): ChainEntry {
  return {
    id, start: iso(startMs), stop: stopMs === null ? null : iso(stopMs), duration: stopMs === null ? -1 : (stopMs - startMs) / 1000,
    description: 'Write the spec', project_id: 4, task_id: 9, tags: ['docs', 'web'], billable: true, ...extra,
  };
}

function memoryStorage(seed: Record<string, string> = {}): ChainStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

test('pausing an entry starts a chain with its stored seconds and a copy of its metadata', () => {
  const stopped = entry(1, T0, T0 + minutes(25));
  const chain = pause(null, stopped, T0 + minutes(26));
  assert.deepEqual(chain, {
    stoppedSeconds: 25 * 60, runningId: null, since: T0 + minutes(26),
    snapshot: { description: 'Write the spec', project_id: 4, task_id: 9, tags: ['docs', 'web'], billable: true },
  });
  assert.equal(isPaused(chain), true);
  stopped.tags.push('later');
  assert.deepEqual(chain.snapshot.tags, ['docs', 'web'], 'the snapshot does not share the entry tags');
});

test('the paused clock shows the chain total and does not move', () => {
  const chain = pause(null, entry(1, T0, T0 + minutes(10)), T0 + minutes(10));
  assert.equal(chainSeconds(chain, null, T0 + minutes(10)), 600);
  assert.equal(chainSeconds(chain, null, T0 + minutes(90)), 600);
});

test('a running clone adds its elapsed time to the stopped seconds, across several cycles', () => {
  let chain = pause(null, entry(1, T0, T0 + minutes(10)), T0 + minutes(10));
  chain = resume(chain, 2, T0 + minutes(15));
  assert.equal(chain.runningId, 2);
  assert.equal(isPaused(chain), false);
  const clone = entry(2, T0 + minutes(15), null);
  assert.equal(chainSeconds(chain, clone, T0 + minutes(15)), 600);
  assert.equal(chainSeconds(chain, clone, T0 + minutes(20) + 7_000), 600 + 5 * 60 + 7);

  chain = pause(chain, entry(2, T0 + minutes(15), T0 + minutes(20)), T0 + minutes(20));
  assert.equal(chain.stoppedSeconds, 15 * 60);
  chain = resume(chain, 3, T0 + minutes(30));
  chain = pause(chain, entry(3, T0 + minutes(30), T0 + minutes(35)), T0 + minutes(35));
  assert.equal(chainSeconds(chain, null, T0 + minutes(60)), 20 * 60);
});

test('the snapshot follows the stopped entry the server returned, so edits while running carry over', () => {
  let chain = pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5));
  chain = resume(chain, 2, T0 + minutes(6));
  chain = pause(chain, entry(2, T0 + minutes(6), T0 + minutes(10), { description: 'Renamed', tags: [], billable: false }), T0 + minutes(10));
  assert.deepEqual(chain.snapshot, { description: 'Renamed', project_id: 4, task_id: 9, tags: [], billable: false });
});

test('pausing an entry that is not the clone starts a new chain', () => {
  let chain = pause(null, entry(1, T0, T0 + minutes(10)), T0 + minutes(10));
  chain = resume(chain, 2, T0 + minutes(11));
  const other = pause(chain, entry(7, T0 + minutes(12), T0 + minutes(17)), T0 + minutes(17));
  assert.equal(other.stoppedSeconds, 5 * 60);
});

test('a stopped entry with zero or missing span stores zero seconds', () => {
  assert.equal(pause(null, entry(1, T0, T0), T0).stoppedSeconds, 0);
  assert.equal(pause(null, { ...entry(1, T0, T0 + minutes(5)), stop: null, duration: 120 }, T0).stoppedSeconds, 120);
});

test('without a chain the clock shows the running entry, or 0 when idle', () => {
  assert.equal(chainSeconds(null, entry(5, T0, null), T0 + 42_000), 42);
  assert.equal(chainSeconds(null, null, T0), 0);
  assert.equal(chainSeconds(null, undefined, T0), 0);
});

test('a running entry other than the clone shows its own time', () => {
  const chain = resume(pause(null, entry(1, T0, T0 + minutes(10)), T0 + minutes(10)), 2, T0 + minutes(11));
  assert.equal(chainSeconds(chain, entry(8, T0 + minutes(12), null), T0 + minutes(13)), 60);
});

test('edits made while paused replace the snapshot', () => {
  const chain = pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5));
  const edited = withSnapshot(chain, { description: 'New', project_id: null, task_id: null, tags: ['x'], billable: false });
  assert.deepEqual(edited.snapshot, { description: 'New', project_id: null, task_id: null, tags: ['x'], billable: false });
  assert.equal(edited.since, chain.since);
  assert.equal(sameSnapshot(chain.snapshot, edited.snapshot), false);
  assert.equal(sameSnapshot(chain.snapshot, { ...chain.snapshot, tags: [...chain.snapshot.tags] }), true);
});

test('a paused chain ends when another client starts a timer', () => {
  const chain = pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5));
  assert.equal(reconcile(chain, null, T0 + minutes(6)), chain, 'nothing running keeps it');
  assert.equal(reconcile(chain, { id: 9 }, T0 + minutes(6)), null);
});

test('a running chain ends when the clone is stopped elsewhere or replaced by another entry', () => {
  const chain = resume(pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5)), 2, T0 + minutes(6));
  assert.equal(reconcile(chain, { id: 2 }, T0 + minutes(7)), chain, 'the clone still running keeps it');
  assert.equal(reconcile(chain, null, T0 + minutes(7)), null);
  assert.equal(reconcile(chain, { id: 3 }, T0 + minutes(7)), null);
});

test('current-entry data from before the last change, or not loaded yet, does not end the chain', () => {
  const chain = pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5));
  assert.equal(reconcile(chain, { id: 1 }, T0 + minutes(5)), chain, 'the stopped entry, fetched before the pause landed');
  assert.equal(reconcile(chain, { id: 1 }, T0 + minutes(4)), chain);
  assert.equal(reconcile(chain, undefined, T0 + minutes(9)), chain);
  assert.equal(reconcile(null, { id: 1 }, T0 + minutes(9)), null);
});

test('the chain is stored per account in a versioned shape that reads back unchanged', () => {
  assert.equal(chainKey(12), 'tokkl.pauseChain.12');
  const chain = resume(pause(null, entry(1, T0, T0 + minutes(5)), T0 + minutes(5)), 2, T0 + minutes(6));
  assert.deepEqual(JSON.parse(serializeChain(chain)), {
    v: 1, stoppedSeconds: 300, runningId: 2, since: T0 + minutes(6),
    snapshot: { description: 'Write the spec', project_id: 4, task_id: 9, tags: ['docs', 'web'], billable: true },
  });
  const storage = memoryStorage();
  assert.equal(saveChain(storage, 12, chain), true);
  assert.deepEqual(loadChain(storage, 12), chain);
  assert.equal(loadChain(storage, 13), null, 'another account on the same browser sees no chain');
  assert.equal(saveChain(storage, 12, null), true);
  assert.equal(storage.map.size, 0);
});

test('a stored chain that is not readable counts as no chain', () => {
  const good = JSON.parse(serializeChain(pause(null, entry(1, T0, T0 + minutes(5)), T0))) as Record<string, unknown>;
  const snapshot = good.snapshot as Record<string, unknown>;
  for (const text of [
    null, '', 'not json', 'null', '[]', '{}',
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, stoppedSeconds: -1 }),
    JSON.stringify({ ...good, stoppedSeconds: '300' }),
    JSON.stringify({ ...good, runningId: 1.5 }),
    JSON.stringify({ ...good, since: null }),
    JSON.stringify({ ...good, snapshot: null }),
    JSON.stringify({ ...good, snapshot: { ...snapshot, tags: [1] } }),
    JSON.stringify({ ...good, snapshot: { ...snapshot, project_id: 'x' } }),
    JSON.stringify({ ...good, snapshot: { ...snapshot, billable: 'yes' } }),
  ]) {
    assert.equal(parseChain(text), null, String(text));
  }
});

test('blocked storage reads as no chain and drops writes', () => {
  const blocked: ChainStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
    get length(): number { throw new Error('blocked'); },
    key: () => { throw new Error('blocked'); },
  };
  assert.equal(loadChain(blocked, 1), null);
  assert.equal(saveChain(blocked, 1, pause(null, entry(1, T0, T0 + minutes(5)), T0)), false, 'a refused write is reported');
  assert.equal(saveChain(blocked, 1, null), false, 'so is a refused removal');
  assert.doesNotThrow(() => forgetChains(blocked));
});

test('signing out forgets every account chain and nothing else', () => {
  const chain: PauseChain = pause(null, entry(1, T0, T0 + minutes(5)), T0);
  const storage = memoryStorage({ 'tokkl.theme': 'dark' });
  saveChain(storage, 1, chain);
  saveChain(storage, 2, chain);
  forgetChains(storage);
  assert.deepEqual([...storage.map.keys()], ['tokkl.theme']);
});
