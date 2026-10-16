import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';

// TT-0129: logging out ends the session in this tab whether or not the request succeeds.
// lib/theme.ts reads localStorage and <html> when it loads, so a minimal browser stands in first.
const storage = new Map<string, string>();
const attributes = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  },
  document: {
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
    querySelectorAll: () => [],
  },
});
const { ApiError } = await import('../api/client.ts');
const { logOut } = await import('./session.ts');

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
});

test('a logout the server answers with an error still clears both, then rejects', async () => {
  answerLogout(async () => new Response('Internal Server Error', { status: 500 }));
  await assert.rejects(logOut(qc), (error: unknown) => error instanceof ApiError && error.status === 500);
  assertSessionEnded();
});

test('a logout that never reaches the server still clears both, then rejects', async () => {
  answerLogout(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(logOut(qc), TypeError);
  assertSessionEnded();
});
