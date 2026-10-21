import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locks } from 'node:worker_threads';
import { plannedEnd, transitionKind } from '@tokkl/common/pomodoroSession';
import { ApiError } from '../api/client.ts';
import type { TimeEntryInput } from '../api/types.ts';
import { pomodoroSessionKey } from './pomodoroSessionState.ts';
import { withPomodoroSessionLock, withTimerOperationLock } from './pomodoroSessionLock.ts';
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

const KEY = pomodoroSessionKey(42);
const START = Date.parse('2026-10-21T10:02:00.123Z');
/** What ending the fixture's first session at 10:31 saves on the 15-minute UTC grid. */
const firstPomodoro = {
  ...fields, start: '2026-10-21T10:00:00.000Z', stop: '2026-10-21T10:30:00.000Z', duration: 1800,
};
const offline = async () => { throw new Error('offline'); };

/** Starts a session in a tab whose saves fail, and ends it at 10:31 so one pomodoro is queued. */
async function queueFailedPomodoro(f: ReturnType<typeof sessionFixture>, save: (entry: TimeEntryInput) => Promise<unknown> = offline) {
  const a = f.tab(42, { save });
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:31:00Z');
  await assert.rejects(a.controller.end(), /offline/);
  return a;
}

test('a failed save stays queued with its snapped span and posts once from a reload when due', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const a = await queueFailedPomodoro(f);
  assert.equal(a.storage.read(), null, 'the session ended although its save failed');
  assert.deepEqual(f.tab().storage.readUnsaved(), [{
    id: `session-1:${START}`, attempts: 1, retryAt: Date.parse('2026-10-21T10:31:05Z'), entry: firstPomodoro,
  }]);

  // A later session's fields and clock must not reach the queued span.
  await a.controller.start(config, { ...fields, description: 'Next task', tags: ['other'] });
  await a.controller.updateFields({ project_id: 9, billable: true });

  const reloaded = f.tab();
  f.at('2026-10-21T10:31:04.999Z');
  await reloaded.controller.retry();
  assert.deepEqual(f.entries, [], 'not due before the backoff');
  f.at('2026-10-21T10:31:05Z');
  await reloaded.controller.retry();
  assert.deepEqual(f.entries, [firstPomodoro]);
  assert.deepEqual(reloaded.storage.readUnsaved(), []);
  await reloaded.controller.retry(true);
  assert.equal(f.entries.length, 1, 'a saved pomodoro is never posted again');
  assert.equal(reloaded.storage.read()?.fields.description, 'Next task', 'the retry leaves the active session alone');
});

test('an accepted save whose answer was lost is reconciled from the actual entries without posting again', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const lookups: string[] = [];
  await queueFailedPomodoro(f, async (entry) => { f.entries.push(entry); throw new Error('offline'); });
  const reloaded = f.tab(42, {
    hasSavedEntry: async (entry) => {
      lookups.push(`${entry.start}/${entry.stop}`);
      return f.entries.some((saved) => saved.start === entry.start && saved.stop === entry.stop);
    },
  });
  await reloaded.controller.retry(true);
  assert.deepEqual(lookups, [`${firstPomodoro.start}/${firstPomodoro.stop}`]);
  assert.equal(f.entries.length, 1);
  assert.deepEqual(reloaded.storage.readUnsaved(), []);
});

test('a failed reconciliation keeps the pomodoro unposted and backs off further', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  let lookups = 0;
  await queueFailedPomodoro(f);
  const reloaded = f.tab(42, { hasSavedEntry: async () => { lookups++; throw new Error('lookup failed'); } });
  f.at('2026-10-21T10:31:05Z');
  await reloaded.controller.retry();
  assert.equal(lookups, 1);
  assert.deepEqual(f.entries, []);
  assert.deepEqual(reloaded.storage.readUnsaved().map(({ attempts, retryAt }) => ({ attempts, retryAt })),
    [{ attempts: 2, retryAt: Date.parse('2026-10-21T10:31:15Z') }]);
  f.at('2026-10-21T10:31:14.999Z');
  await reloaded.controller.retry();
  assert.equal(lookups, 1, 'the doubled backoff holds');
});

for (const status of [400, 403, 422]) {
  test(`a ${status} answer drops the pomodoro and shows the server's message`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    const a = f.tab(42, { save: async () => { throw new ApiError(status, 'Project 3 is archived'); } });
    await a.controller.start(config, fields);
    f.at('2026-10-21T10:31:00Z');
    await a.controller.end();
    assert.deepEqual(f.messages, ['Project 3 is archived']);
    assert.deepEqual(a.storage.readUnsaved(), []);
    assert.equal(f.disk.getItem(KEY), null);
  });
}

for (const status of [401, 408, 429, 500]) {
  test(`a ${status} answer keeps the pomodoro queued for a retry`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    const a = f.tab(42, { save: async () => { throw new ApiError(status, 'Try again'); } });
    await a.controller.start(config, fields);
    f.at('2026-10-21T10:31:00Z');
    await assert.rejects(a.controller.end(), (error) => error instanceof ApiError && error.status === status);
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.tab().storage.readUnsaved().map(({ entry, attempts }) => ({ entry, attempts })),
      [{ entry: firstPomodoro, attempts: 1 }]);
  });
}

test('tabs retrying the same due pomodoro make one attempt between them', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  let posts = 0;
  await queueFailedPomodoro(f);
  const failing = async () => { posts++; throw new Error('offline'); };
  const [b, c] = [f.tab(42, { save: failing }), f.tab(42, { save: failing })];
  // Both tabs wake while the lock is busy, so both have seen the same attempt count.
  const entered = signal();
  const release = signal();
  t.after(release.resolve);
  const holder = withPomodoroSessionLock(42, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const retries = [b.controller.retry(true), c.controller.retry(true)];
  release.resolve();
  await Promise.all([holder, ...retries]);
  assert.equal(posts, 1);
  assert.equal(f.tab().storage.readUnsaved()[0]?.attempts, 2);

  const [d, e] = [f.tab(), f.tab()];
  await Promise.all([d.controller.retry(true), e.controller.retry(true)]);
  assert.deepEqual(f.entries, [firstPomodoro]);
  assert.deepEqual(f.tab().storage.readUnsaved(), []);
});

test('a memory-only session keeps its failed save in this tab and retries it from memory', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  let online = false;
  const a = f.tab(42, {
    storage: () => { throw new DOMException('Storage is disabled', 'SecurityError'); },
    save: async (entry) => { if (!online) throw new Error('offline'); f.entries.push(entry); },
  });
  await a.controller.start(config, fields);
  f.at('2026-10-21T10:31:00Z');
  await assert.rejects(a.controller.end(), /offline/);
  assert.deepEqual(a.storage.readUnsaved().map(({ entry }) => entry), [firstPomodoro]);
  assert.deepEqual(f.tab().storage.readUnsaved(), [], 'another tab cannot see or replay it');
  online = true;
  await a.controller.retry(true);
  assert.deepEqual(f.entries, [firstPomodoro]);
  assert.deepEqual(a.storage.readUnsaved(), []);
});

test('a shared queued pomodoro is not retried until its attempt can be stored', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  await queueFailedPomodoro(f);
  let full = true;
  const quota: Storage = {
    getItem: (key) => f.disk.getItem(key),
    setItem: (key, value) => {
      if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      f.disk.setItem(key, value);
    },
    removeItem: (key) => f.disk.removeItem(key),
    clear: () => f.disk.clear(),
    key: (index) => f.disk.key(index),
    get length() { return f.disk.length; },
  };
  const b = f.tab(42, { storage: () => quota });
  await b.controller.retry(true);
  assert.deepEqual(f.entries, []);
  assert.equal(f.tab().storage.readUnsaved()[0]?.attempts, 1, 'the stored attempt count is unchanged');
  full = false;
  await b.controller.retry(true);
  assert.deepEqual(f.entries, [firstPomodoro]);
});

for (const accepted of [false, true]) {
  test(`a reload finishes an End interrupted ${accepted ? 'after' : 'before'} the server stored it, keeping its span`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    let crashed: string | null = null;
    const a = f.tab(42, {
      save: async (entry) => {
        // The page closes while this request is in flight; storage holds what it held then.
        crashed = f.disk.getItem(KEY);
        if (accepted) f.entries.push(entry);
        throw new Error('page closed');
      },
    });
    await a.controller.start(config, fields);
    f.at('2026-10-21T10:31:00Z');
    await assert.rejects(a.controller.end(), /page closed/);
    a.controller.close();
    f.disk.setItem(KEY, crashed!);

    const reloaded = f.tab();
    assert.equal(reloaded.storage.read()?.ending, true);
    f.at('2026-10-21T11:10:00Z');
    await reloaded.controller.retry();
    assert.equal(reloaded.storage.read(), null);
    assert.deepEqual(f.entries, [firstPomodoro]);
    assert.deepEqual(reloaded.storage.readUnsaved(), []);
  });
}

for (const succeeds of [true, false]) {
  test(`sign-out makes one ${succeeds ? 'successful' : 'failed'} final attempt and clears the queue without replaying it`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t);
    const posts: string[] = [];
    let failing = true;
    const a = f.tab(42, {
      save: async (entry) => {
        posts.push(entry.stop ?? 'running');
        if (failing) throw new Error('offline');
        f.entries.push(entry);
      },
    });
    await a.controller.start(config, fields);
    f.at('2026-10-21T10:31:00Z');
    await assert.rejects(a.controller.end(), /offline/);
    await a.controller.start(config, fields);
    f.at('2026-10-21T11:01:00Z');
    failing = !succeeds;
    if (succeeds) await a.controller.end(true);
    else await assert.rejects(a.controller.end(true), /offline/);
    const final = '2026-10-21T11:00:00.000Z';
    assert.deepEqual(posts, [firstPomodoro.stop, final], 'the earlier failure is not drained');
    assert.deepEqual(f.entries.map(({ stop }) => stop), succeeds ? [final] : []);
    assert.equal(f.disk.getItem(KEY), null);
    await a.controller.retry(true);
    await f.tab().controller.retry(true);
    assert.equal(posts.length, 2);
  });
}

test('a remote timer ends the session at its server start on the account grid, once across tabs', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  Object.assign(f.grid, { minutes: 20, timeZone: 'Asia/Kathmandu' });
  const [a, b] = [f.tab(), f.tab()];
  await a.controller.start(config, fields);
  const reads = f.clockReads;
  await a.controller.observeTimer({ id: 800, start: '2026-10-21T09:50:00Z' });
  await b.controller.observeTimer({ id: 801, start: new Date(START).toISOString() });
  assert.equal(a.storage.read()?.ending, false, 'a timer started at or before the pomodoro is not a new start');

  const remote = { id: 900, start: '2026-10-21T10:31:00Z' };
  await Promise.all([a.controller.observeTimer(remote), b.controller.observeTimer(remote)]);
  assert.deepEqual(f.entries, [{
    ...fields, start: '2026-10-21T09:55:00.000Z', stop: '2026-10-21T10:35:00.000Z', duration: 2400,
  }]);
  assert.equal(a.storage.read(), null);
  assert.equal(f.clockReads, reads, 'the server start is the only instant used');
});

test('a local timer start saves the session at its captured instant before creating the timer', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const order: string[] = [];
  const a = f.tab(42, { save: async (entry) => { order.push(`save ${entry.stop}`); f.entries.push(entry); } });
  await a.controller.start(config, fields);
  f.at('2026-10-21T15:00:00Z');
  const created = await a.controller.startTimer(new Date('2026-10-21T10:31:00.900Z'), async () => {
    order.push(`create, session ${a.storage.read() === null ? 'ended' : 'active'}`);
    return { id: 901 };
  });
  assert.deepEqual(created, { id: 901 });
  assert.deepEqual(order, [`save ${firstPomodoro.stop}`, 'create, session ended']);
  assert.equal(f.clockReads, 1, 'only the session start read the clock');

  await a.controller.start(config, fields);
  const session = a.storage.read();
  const stale = await a.controller.startTimer(new Date('2026-10-21T15:10:00Z'), async () => assert.fail('a stale start must not create'), () => false);
  assert.equal(stale, null);
  assert.deepEqual(a.storage.read(), session, 'a refused start leaves the session running');
});

test('a session queued behind a local timer start stops that timer and ignores its refetch', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const stops: string[] = [];
  const created = signal();
  const a = f.tab(42, { beforeStart: async (at) => { stops.push(at.toISOString()); } });
  const timer = a.controller.startTimer(new Date('2026-10-21T10:31:00.900Z'), async () => {
    await created.promise;
    return { id: 901 };
  });
  f.at('2026-10-21T10:31:00.950Z');
  const session = a.controller.start(config, fields);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(stops, [], 'the session waits for the timer request');
  created.resolve();
  await Promise.all([timer, session]);
  assert.deepEqual(stops, ['2026-10-21T10:31:00.950Z']);
  await a.controller.observeTimer({ id: 901, start: '2026-10-21T10:31:00Z' });
  await f.tab().controller.observeTimer({ id: 901, start: '2026-10-21T10:31:00Z' });
  assert.equal(a.storage.read()?.ending, false);
  assert.deepEqual(f.entries, []);
});

test('a pause runs without a session but not once a queued session start wins the lock', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t);
  const paused: string[] = [];
  const entered = signal();
  const release = signal();
  t.after(release.resolve);
  const a = f.tab(42, { beforeStart: async () => { entered.resolve(); await release.promise; } });
  await a.controller.pauseTimer(async () => { paused.push('idle'); });
  const session = a.controller.start(config, fields);
  await entered.promise;
  const pause = a.controller.pauseTimer(async () => { paused.push('during session'); });
  release.resolve();
  await Promise.all([session, pause]);
  assert.deepEqual(paused, ['idle']);
  assert.ok(a.storage.read());
});

test('timer operations share the session lock, and run unlocked only without a session or lock manager', { timeout: 5_000 }, async (t) => {
  sessionFixture(t);
  const ran: string[] = [];
  const entered = signal();
  const release = signal();
  t.after(release.resolve);
  const holder = withPomodoroSessionLock(42, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const queued = withTimerOperationLock(42, false, async () => { ran.push('account 42'); });
  await withTimerOperationLock(43, false, async () => { ran.push('account 43'); });
  assert.deepEqual(ran, ['account 43']);
  release.resolve();
  await Promise.all([holder, queued]);
  assert.deepEqual(ran, ['account 43', 'account 42']);

  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  assert.equal(await withTimerOperationLock(42, false, async () => 'plain timer'), 'plain timer');
  await assert.rejects(withTimerOperationLock(42, true, async () => assert.fail('unlocked session save')), /HTTPS or localhost/);
});
