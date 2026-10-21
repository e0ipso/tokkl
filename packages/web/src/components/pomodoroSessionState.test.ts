import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPomodoroSessionStorage, forgetPomodoroSessions, parsePomodoroSession, pomodoroSessionKey } from './pomodoroSessionState.ts';
import { config, fields, sessionFixture } from './pomodoroSessionTestSupport.ts';

// These records describe the web storage format, not the shared phase-model fixture format.
const record = {
  version: 1, id: 'restored', revision: 1, ending: false, config, fields,
  phase: { kind: 'shortRest', completed: 1, startedAt: Date.parse('2026-10-21T10:27:00Z') },
  pomodoroStart: Date.parse('2026-10-21T10:02:00Z'),
};

for (const [name, text] of [
  ['missing', null], ['invalid JSON', '{broken'], ['JSON null', 'null'],
  ['unknown version', JSON.stringify({ ...record, version: 2 })],
  ['invalid phase', JSON.stringify({ ...record, phase: { ...record.phase, kind: 'unknown' } })],
  ['invalid completed count', JSON.stringify({ ...record, phase: { ...record.phase, completed: -1 } })],
  ['invalid configuration', JSON.stringify({ ...record, config: { ...config, workMinutes: 0 } })],
  ['invalid fields', JSON.stringify({ ...record, fields: { ...fields, tags: [42] } })],
  ['start after phase', JSON.stringify({ ...record, pomodoroStart: record.phase.startedAt + 1 })],
  ['invalid revision', JSON.stringify({ ...record, revision: -1 })],
] as const) {
  test(`${name} storage is treated as no session`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    if (text !== null) f.disk.setItem(pomodoroSessionKey(42), text);
    assert.equal(parsePomodoroSession(text), null);
    const tab = f.tab();
    assert.equal(tab.storage.read(), null);
    await tab.controller.start(config, fields);
    assert.equal(tab.storage.read()?.phase.kind, 'work', 'unreadable data does not prevent a fresh start');
    assert.deepEqual(f.entries, []);
  });
}

test('separate accounts keep independent fields, phases and cleanup', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab(42);
  const b = f.tab(43);
  await a.controller.start(config, fields);
  assert.equal(b.storage.read(), null);
  await b.controller.start(config, { ...fields, description: 'Other account' });
  f.at('2026-10-21T10:27:00Z');
  await a.controller.nextPhase();
  assert.equal(b.storage.read()?.phase.kind, 'work');
  assert.equal(a.storage.read()?.fields.description, fields.description);
  await a.controller.end();
  assert.equal(a.storage.read(), null);
  assert.equal(f.tab(43).storage.read()?.fields.description, 'Other account');
  f.disk.setItem('other.preference', 'keep');
  forgetPomodoroSessions(f.disk);
  assert.equal(a.storage.read(), null);
  assert.equal(b.storage.read(), null);
  assert.equal(f.disk.getItem('other.preference'), 'keep');
});

for (const failure of ['access', 'quota'] as const) {
  test(`sessions started with blocked storage (${failure}) can edit, advance, save and end from memory`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    if (failure === 'quota') t.mock.method(f.disk, 'setItem', () => { throw new Error('quota exceeded'); });
    const options = failure === 'access' ? { storage: (): Storage => { throw new Error('storage blocked'); } } : {};
    const a = f.tab(42, options);
    await a.controller.start(config, fields);
    await a.controller.updateFields({ description: 'Memory edit' });
    f.at('2026-10-21T10:27:00Z');
    await a.controller.nextPhase();
    assert.equal(a.storage.read()?.phase.kind, 'shortRest');
    assert.equal(f.entries.length, 0);
    f.at('2026-10-21T10:35:00Z');
    await a.controller.nextPhase();
    f.at('2026-10-21T11:00:00Z');
    await a.controller.end();
    assert.deepEqual(f.entries.map((entry) => entry.description), ['Memory edit', 'Memory edit']);
    assert.equal(f.entries[0]?.stop, f.entries[1]?.start);
    assert.equal(a.storage.read(), null);
    assert.equal(f.disk.getItem(pomodoroSessionKey(42)), null);
    assert.equal(f.tab(42, options).storage.read(), null, 'a new tab cannot reload an unpersisted session');
  });
}

test('a shared session refuses a save without a durable claim and can resume after storage recovers', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  const b = f.tab();
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:27:00Z');
  await a.controller.nextPhase();
  const expected = b.storage.read();
  const setItem = t.mock.method(f.disk, 'setItem', () => { throw new Error('quota exceeded'); });
  f.at('2026-10-21T10:35:00Z');
  await assert.rejects(a.controller.nextPhase(), /Free some browser storage/);
  await assert.rejects(b.controller.end(), /Free some browser storage/);
  assert.deepEqual(f.entries, []);
  assert.deepEqual(f.tab().storage.read(), expected);
  setItem.mock.restore();
  await Promise.all([a.controller.nextPhase(expected), b.controller.nextPhase(expected)]);
  assert.equal(f.entries.length, 1);
  assert.equal(a.storage.read()?.phase.kind, 'work');
});

test('a foreign durable write replaces a refused local edit, and forgetting drops the memory fallback', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  await a.controller.start(config, fields);
  const setItem = t.mock.method(f.disk, 'setItem', () => { throw new Error('quota exceeded'); });
  await a.controller.updateFields({ description: 'Local only' });
  assert.equal(a.storage.read()?.fields.description, 'Local only');
  setItem.mock.restore();
  const b = f.tab();
  assert.equal(b.storage.read()?.fields.description, fields.description);
  await b.controller.updateFields({ description: 'Foreign write' });
  assert.equal(a.storage.read()?.fields.description, 'Foreign write');
  const memory = createPomodoroSessionStorage(42, () => { throw new Error('blocked'); });
  memory.write(a.storage.read());
  assert.equal(memory.read()?.fields.description, 'Foreign write');
  memory.forget();
  assert.equal(memory.read(), null);
});

test('field snapshots discard entry-only properties and do not retain caller-owned tags', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab(42, { storage: () => { throw new Error('blocked'); } });
  const draft = { ...fields, tags: ['original'], start: 'ignored', stop: 'ignored', duration: 999 };
  await a.controller.start(config, draft);
  draft.tags.push('mutated');
  assert.deepEqual(a.storage.read()?.fields, { ...fields, tags: ['original'] });
  const tags = ['edited'];
  await a.controller.updateFields({ tags });
  tags.push('mutated again');
  f.at('2026-10-21T10:35:00Z');
  await a.controller.end();
  assert.deepEqual(f.entries, [{
    ...fields, tags: ['edited'], start: '2026-10-21T10:00:00.000Z', stop: '2026-10-21T10:30:00.000Z', duration: 1800,
  }]);
});
