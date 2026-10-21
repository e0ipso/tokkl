import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locks } from 'node:worker_threads';
import { plannedEnd, transitionKind } from '@tokkl/common/pomodoroSession';
import { pomodoroSessionKey } from './pomodoroSessionState.ts';
import { withPomodoroSessionLock } from './pomodoroSessionLock.ts';
import { config, fields, sessionFixture, signal } from './pomodoroSessionTestSupport.ts';

for (const scenario of [
  { minutes: 15, timeZone: 'UTC', boundaries: ['10:00', '10:30', '11:15', '11:45'] },
  { minutes: 20, timeZone: 'Asia/Kathmandu', boundaries: ['09:55', '10:35', '11:15', '11:55'] },
]) {
  test(`several pomodoros save adjacent stopped entries on the ${scenario.minutes}-minute ${scenario.timeZone} grid`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    Object.assign(f.grid, scenario);
    const { controller, storage } = f.tab();
    await controller.start(config, fields);
    const edited = { description: 'Final proposal', project_id: 5, task_id: 9, tags: ['review'], billable: true };
    const steps = [
      ['10:27:00.456', '10:35:00.789'],
      ['11:00:00.111', '11:16:00.222'],
    ];
    for (const [rest, work] of steps) {
      f.at(`2026-10-21T${rest}Z`);
      const before = f.entries.length;
      await controller.nextPhase();
      assert.equal(f.entries.length, before, 'entering rest creates no separate work entry');
      await controller.updateFields(edited);
      f.at(`2026-10-21T${work}Z`);
      await controller.nextPhase();
      assert.equal(storage.read()?.phase.startedAt.toISOString(), `2026-10-21T${work}Z`);
      assert.equal(storage.read()?.pomodoroStart, Date.parse(`2026-10-21T${work}Z`));
    }
    f.at('2026-10-21T11:45:00.333Z');
    await controller.end();
    const boundaries = scenario.boundaries.map((clock) => `2026-10-21T${clock}:00.000Z`);
    assert.deepEqual(f.entries, boundaries.slice(0, -1).map((start, i) => ({
      ...edited, start, stop: boundaries[i + 1],
      duration: (Date.parse(boundaries[i + 1]!) - Date.parse(start)) / 1000,
    })));
    assert.equal(f.entries[0]?.stop, f.entries[1]?.start);
    assert.equal(f.entries[1]?.stop, f.entries[2]?.start);
    assert.equal(storage.read(), null);
  });
}

for (const operation of ['end', 'nextPhase'] as const) {
  test(`a collapsed ${operation} posts nothing and reports the too-short message`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    const { controller, storage } = f.tab();
    await controller.start(config, fields);
    if (operation === 'nextPhase') await controller.nextPhase();
    f.at('2026-10-21T10:02:01.123Z');
    await controller[operation]();
    assert.deepEqual(f.entries, []);
    assert.deepEqual(f.messages, ['This pomodoro was too short to save.']);
    if (operation === 'end') assert.equal(storage.read(), null);
    else assert.equal(storage.read()?.phase.startedAt.toISOString(), '2026-10-21T10:02:01.123Z');
  });
}

test('reloads preserve the current phase, completed count, planned end, transition and edited fields', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  let tab = f.tab();
  await tab.controller.start(config, fields);
  const edited = { ...fields, description: 'From another tab', tags: ['new'], billable: true };
  await tab.controller.updateFields(edited);
  const phases = [
    ['10:02:00.123', 'work', 0, '10:27:00.123', 'workToShortRest'],
    ['10:27:00.123', 'shortRest', 1, '10:32:00.123', 'shortRestToWork'],
    ['10:35:00.123', 'work', 1, '11:00:00.123', 'workToLongRest'],
    ['11:00:00.123', 'longRest', 2, '11:15:00.123', 'longRestToWork'],
    ['11:16:00.123', 'work', 0, '11:41:00.123', 'workToShortRest'],
  ] as const;
  for (const [i, [start, kind, completed, end, transition]] of phases.entries()) {
    if (i > 0) {
      f.at(`2026-10-21T${start}Z`);
      await tab.controller.nextPhase();
    }
    tab.controller.close();
    tab = f.tab();
    const state = tab.storage.read();
    assert.ok(state);
    assert.deepEqual(state.phase, { kind, completed, startedAt: new Date(`2026-10-21T${start}Z`) });
    assert.equal(plannedEnd(state.phase, state.config).toISOString(), `2026-10-21T${end}Z`);
    assert.equal(transitionKind(state.phase, state.config), transition);
    assert.deepEqual(state.fields, edited);
    assert.deepEqual(state.config, config);
  }
  assert.equal(f.entries.length, 2);
});

test('each operation samples the clock once, before waiting for its lock', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const { controller, storage } = f.tab();
  for (const [i, operation] of [
    () => controller.start(config, fields),
    () => controller.updateFields({ description: 'Edited' }),
    () => controller.nextPhase(),
    () => controller.end(),
  ].entries()) {
    const entered = signal();
    const release = signal();
    t.after(release.resolve);
    const blocker = withPomodoroSessionLock(42, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const at = `2026-10-21T10:${10 + i * 10}:00.123Z`;
    f.at(at);
    const pending = operation();
    assert.equal(f.clockReads, i + 1, 'one read at invocation');
    f.at('2026-10-21T15:00:00.000Z');
    release.resolve();
    await blocker;
    await pending;
    assert.equal(f.clockReads, i + 1, 'no later clock sample');
    if (i === 0 || i === 2) assert.equal(storage.read()?.phase.startedAt.toISOString(), at);
  }
  assert.equal(f.entries[0]?.stop, '2026-10-21T10:45:00.000Z');
});

test('two tabs confirming the same phase revision save each pomodoro once with current foreign edits', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  const b = f.tab();
  await Promise.all([a.controller.start(config, fields), b.controller.start(config, fields)]);
  assert.equal(a.storage.read()?.id, b.storage.read()?.id);
  for (const [rest, work, description] of [
    ['10:27', '10:35', 'First edit'], ['11:00', '11:16', 'Second edit'],
  ]) {
    f.at(`2026-10-21T${rest}:00.000Z`);
    const workA = a.storage.read();
    const workB = b.storage.read();
    await Promise.all([a.controller.nextPhase(workA), b.controller.nextPhase(workB)]);
    const restA = a.storage.read();
    const restB = b.storage.read();
    assert.equal(restA?.revision, restB?.revision);
    await b.controller.updateFields({ description, tags: [description!] });
    f.at(`2026-10-21T${work}:00.000Z`);
    await Promise.all([a.controller.nextPhase(restA), b.controller.nextPhase(restB)]);
    await b.controller.nextPhase(restB);
    assert.equal(a.storage.read()?.phase.kind, 'work', 'stale rendered confirmations do not skip another phase');
  }
  assert.deepEqual(f.entries.map(({ description, tags }) => ({ description, tags })), [
    { description: 'First edit', tags: ['First edit'] }, { description: 'Second edit', tags: ['Second edit'] },
  ]);
  assert.equal(f.entries[0]?.stop, f.entries[1]?.start);
});

test('the real lock holds the durable save claim until completion and serializes foreign edits', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const entered = signal();
  const release = signal();
  t.after(release.resolve);
  const a = f.tab(42, { save: async (entry) => {
    f.entries.push(entry); entered.resolve(); await release.promise;
  } });
  const b = f.tab();
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:27:00Z');
  await a.controller.nextPhase();
  const expected = b.storage.read();
  f.at('2026-10-21T10:35:00Z');
  const saving = a.controller.nextPhase();
  await entered.promise;
  assert.equal(f.tab().storage.read()?.phase.kind, 'work', 'reload sees the claim before POST settles');
  const duplicate = b.controller.nextPhase(expected);
  const editing = b.controller.updateFields({ description: 'Next pomodoro' });
  const queue = await locks.query();
  assert.equal(queue.held?.filter((lock) => lock.name === pomodoroSessionKey(42) && lock.mode === 'exclusive').length, 1);
  assert.equal(queue.pending?.filter((lock) => lock.name === pomodoroSessionKey(42)).length, 2);
  assert.equal(b.storage.read()?.fields.description, fields.description);
  release.resolve();
  await Promise.all([saving, duplicate, editing]);
  assert.equal(f.entries.length, 1);
  assert.equal(f.entries[0]?.description, fields.description);
  assert.equal(a.storage.read()?.fields.description, 'Next pomodoro');
  f.at('2026-10-21T11:00:00Z');
  await b.controller.end();
  assert.equal(f.entries[1]?.description, 'Next pomodoro');
});

test('a rejected save retains its claim so a second tab cannot replay the same pomodoro', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab(42, { save: async (entry) => { f.entries.push(entry); throw new Error('save offline'); } });
  const b = f.tab();
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:27:00Z');
  await a.controller.nextPhase();
  const expected = b.storage.read();
  f.at('2026-10-21T10:35:00Z');
  await assert.rejects(a.controller.nextPhase(), /save offline/);
  await b.controller.nextPhase(expected);
  assert.equal(f.entries.length, 1);
  assert.equal(f.tab().storage.read()?.phase.kind, 'work');
});

test('closing an account invalidates operations already queued for its lock', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  await a.controller.start(config, fields);
  const original = a.storage.read();
  const entered = signal();
  const release = signal();
  t.after(release.resolve);
  const blocker = withPomodoroSessionLock(42, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  f.at('2026-10-21T10:40:00Z');
  const queued = [a.controller.nextPhase(), a.controller.updateFields({ description: 'Stale edit' }), a.controller.end()];
  a.controller.close();
  release.resolve();
  await blocker;
  await Promise.all(queued);
  assert.deepEqual(a.storage.read(), original);
  assert.deepEqual(f.entries, []);
});

test('without a lock manager operations refuse to perform an unlocked save', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:40:00Z');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await assert.rejects(a.controller.end(), /HTTPS or localhost/);
  assert.deepEqual(f.entries, []);
  assert.equal(a.storage.read()?.ending, false);
});

test('concurrent field patches from separate tabs merge into the current and following pomodoros', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = f.tab();
  const b = f.tab();
  await a.controller.start(config, fields);
  await Promise.all([
    a.controller.updateFields({ description: 'Renamed', project_id: 8, task_id: null }),
    b.controller.updateFields({ tags: ['shared'], billable: true }),
  ]);
  const edited = { description: 'Renamed', project_id: 8, task_id: null, tags: ['shared'], billable: true };
  assert.deepEqual(a.storage.read()?.fields, edited);
  assert.deepEqual(b.storage.read()?.fields, edited);
  f.at('2026-10-21T10:27:00Z');
  await a.controller.nextPhase();
  f.at('2026-10-21T10:35:00Z');
  await b.controller.nextPhase();
  f.at('2026-10-21T11:00:00Z');
  await a.controller.end();
  assert.deepEqual(f.entries.map(({ start, stop, duration, ...metadata }) => metadata), [edited, edited]);
});
