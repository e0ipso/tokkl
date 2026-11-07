import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReminderStore, reminderKey } from './reminderStore.ts';

function memoryStorage(map = new Map<string, string>()): Storage {
  return {
    get length() {
      return map.size;
    },
    key: index => [...map.keys()][index] ?? null,
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
  };
}

const events = { addEventListener: () => {}, removeEventListener: () => {} };
const key = reminderKey(7);

test('a written reminder reads back as the same object until the stored text changes', () => {
  const storage = memoryStorage();
  const store = createReminderStore(() => storage, events);
  assert.equal(store.read(key), null);
  store.write(key, { timer: '1:2026-10-20T09:00:00Z', notified: true, confirmed: false });
  const first = store.read(key);
  assert.deepEqual(first, { timer: '1:2026-10-20T09:00:00Z', notified: true, confirmed: false });
  assert.equal(store.read(key), first);
});

test('damaged stored values read as nothing', () => {
  const storage = memoryStorage(new Map([[key, '{"timer":1}']]));
  assert.equal(createReminderStore(() => storage, events).read(key), null);
});

test('blocked storage keeps the reminder in memory and still tells subscribers', () => {
  const blocked = () => {
    throw new Error('blocked');
  };
  const store = createReminderStore(blocked, events);
  let changes = 0;
  const stop = store.subscribe(() => changes++);
  store.write(key, { timer: 't', notified: true, confirmed: true });
  stop();
  assert.equal(changes, 1);
  assert.deepEqual(store.read(key), { timer: 't', notified: true, confirmed: true });
});
