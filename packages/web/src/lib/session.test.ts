import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';

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

test('logout sends only the logout request: a running Pomodoro session stays on the server', async () => {
  qc.setQueryData(['timer'], { revision: 3, pomodoro: { entry_id: 7 } });
  answerLogout(async () => new Response(null, { status: 200 }));
  await logOut(qc);
  assert.deepEqual(requests, [{ url: '/api/app/logout', method: 'POST' }]);
  assertSessionEnded();
});
