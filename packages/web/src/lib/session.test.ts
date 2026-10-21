import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { config, fields, sessionFixture, signal } from '../components/pomodoroSessionTestSupport.ts';
import { pomodoroSessionKey } from '../components/pomodoroSessionState.ts';
import { forgetActivePomodoroSession, registerPomodoroSession } from '../components/pomodoroSessionLifecycle.ts';

// Logging out ends the session in this tab whether or not the request succeeds.
// A failed request leaves a one-time flag so the reloaded app can say logout failed.
// lib/theme.ts reads localStorage and <html> when it loads, so a minimal browser stands in first.
const storage = new Map<string, string>();
const tabStorage = new Map<string, string>();
const attributes = new Map<string, string>();
const fakeStorage = (map: Map<string, string>): Storage => ({
  get length() { return map.size; },
  key: (index) => [...map.keys()][index] ?? null,
  clear: () => map.clear(),
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => void map.set(key, value),
  removeItem: (key: string) => void map.delete(key),
});
Object.assign(globalThis, {
  window: { localStorage: fakeStorage(storage), sessionStorage: fakeStorage(tabStorage) },
  document: {
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
    querySelectorAll: () => [],
  },
});
const { ApiError } = await import('../api/client.ts');
const { chainKey } = await import('../components/pauseChain.ts');
const { readTabChain, writeTabChain } = await import('../components/tabChain.ts');
const { endSession, logOut, takeLogoutFailure } = await import('./session.ts');

const realFetch = globalThis.fetch;
let qc: QueryClient;
let requests: Array<{ url: string; method: string | undefined }>;

/** A signed-in tab: cached queries and a cached dark theme on <html>. */
beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(['me'], { email: 'someone@example.com', fullname: 'Someone' });
  qc.setQueryData(['preferences'], { theme: 'dark' });
  storage.clear();
  storage.set('tokkl.theme', 'dark');
  tabStorage.clear();
  attributes.clear();
  attributes.set('data-theme', 'dark');
  requests = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  forgetActivePomodoroSession();
});

function answerLogout(answer: () => Promise<Response>) {
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method });
    return answer();
  };
}

function assertSessionEnded() {
  assert.equal(qc.getQueryCache().getAll().length, 0, 'no cached queries');
  assert.equal(storage.has('tokkl.theme'), false, 'no cached theme');
  assert.equal(attributes.has('data-theme'), false, 'the page follows the system theme');
}

test('a successful logout clears the query cache and the cached theme', async () => {
  answerLogout(async () => new Response(null, { status: 200 }));
  await logOut(qc);
  assert.deepEqual(requests, [{ url: '/api/app/logout', method: 'POST' }]);
  assertSessionEnded();
  assert.equal(takeLogoutFailure(), false, 'no failure message');
});

test('a logout the server answers with an error still clears both, then rejects', async () => {
  answerLogout(async () => new Response('Internal Server Error', { status: 500 }));
  await assert.rejects(logOut(qc), (error: unknown) => error instanceof ApiError && error.status === 500);
  assertSessionEnded();
  assert.equal(takeLogoutFailure(), true, 'the next page load says logout failed');
  assert.equal(takeLogoutFailure(), false, 'once');
});

test('a logout that never reaches the server still clears both, then rejects', async () => {
  answerLogout(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(logOut(qc), TypeError);
  assertSessionEnded();
  assert.equal(takeLogoutFailure(), true, 'the next page load says logout failed');
});

test('a session that ends after a failed logout drops the failure message', async () => {
  answerLogout(async () => new Response('Internal Server Error', { status: 500 }));
  await assert.rejects(logOut(qc));
  endSession(qc);
  assert.equal(takeLogoutFailure(), false, 'the login page does not say the user is still signed in');
});

test('a session that ends after storage refused a pause leaves no chain for the next sign-in', () => {
  const localStorage = window.localStorage;
  const setItem = localStorage.setItem;
  const paused = {
    stoppedSeconds: 600, runningId: null, since: 1_600,
    snapshot: { description: 'Write the spec', project_id: 4, task_id: null, tags: [], billable: false },
  };
  localStorage.setItem = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  try {
    writeTabChain(7, paused);
    assert.equal(storage.has(chainKey(7)), false, 'storage refused the chain');
    assert.deepEqual(readTabChain(7), paused, 'the tab keeps it while the session lasts');
    endSession(qc);
    assert.equal(readTabChain(7), null, 'signing back in to the same account starts without a chain');
  } finally {
    localStorage.setItem = setItem;
  }
});

for (const saveFails of [false, true]) {
  test(`logout waits for a ${saveFails ? 'failed' : 'successful'} Pomodoro save, clears it and never replays it`, { timeout: 5_000 }, async (t) => {
    const f = sessionFixture(t, window.localStorage);
    const entered = signal();
    const release = signal();
    t.after(release.resolve);
    const events: string[] = [];
    const tab = f.tab(42, { save: async (entry) => {
      f.entries.push(entry);
      events.push('save');
      entered.resolve();
      await release.promise;
      events.push('settled');
      if (saveFails) throw new Error('Save failed');
    } });
    await tab.controller.start(config, fields);
    f.at('2026-10-21T10:35:00Z');
    t.after(registerPomodoroSession({
      finish: () => tab.controller.end(),
      forget: () => { events.push('forget'); tab.controller.close(); tab.storage.forget(); },
    }));
    answerLogout(async () => {
      events.push('logout');
      assert.equal(window.localStorage.getItem(pomodoroSessionKey(42)), null);
      return new Response(null, { status: 200 });
    });
    const loggingOut = logOut(qc);
    await entered.promise;
    assert.deepEqual(events, ['save']);
    assert.deepEqual(requests, []);
    assert.equal(tab.storage.read()?.ending, true, 'the durable claim survives until the save settles');
    assert.ok(qc.getQueryData(['me']), 'the signed-in cache remains while saving');
    release.resolve();
    await loggingOut;
    assert.deepEqual(events, ['save', 'settled', 'logout', 'forget']);
    assertSessionEnded();
    assert.equal(tab.storage.read(), null);
    assert.equal(f.tab().storage.read(), null);
    assert.equal(f.entries.length, 1);
    assert.equal(f.entries[0]?.stop, '2026-10-21T10:30:00.000Z');
    await logOut(qc);
    assert.equal(f.entries.length, 1, 'the failed or successful final save is never retried');
    assert.equal(takeLogoutFailure(), false);
  });
}

test('logout during rest saves one span from the work start without a separate rest entry', { timeout: 5_000 }, async (t) => {
  const f = sessionFixture(t, window.localStorage);
  const tab = f.tab();
  await tab.controller.start(config, fields);
  f.at('2026-10-21T10:27:00Z');
  await tab.controller.nextPhase();
  assert.deepEqual(f.entries, []);
  t.after(registerPomodoroSession({
    finish: () => tab.controller.end(),
    forget: () => { tab.controller.close(); tab.storage.forget(); },
  }));
  f.at('2026-10-21T10:35:00Z');
  answerLogout(async () => new Response(null, { status: 200 }));
  await logOut(qc);
  assert.deepEqual(f.entries, [{
    ...fields, start: '2026-10-21T10:00:00.000Z', stop: '2026-10-21T10:30:00.000Z', duration: 1800,
  }]);
  assert.equal(tab.storage.read(), null);
  assertSessionEnded();
});
