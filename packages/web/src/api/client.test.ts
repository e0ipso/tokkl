import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEADLINE_MS, RequestTimeoutError, api, rawBody, requestKind, withDeadline } from './client.ts';
import { t } from '../i18n/messages.ts';

/** Work that never answers: it fails only when its signal aborts, with the signal's reason, as fetch does. */
const hang = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

const request = { method: 'POST', path: '/api/app/timer/resume' } as const;

test('a request with no reply by its deadline fails as timed out, naming the request', async () => {
  await assert.rejects(
    withDeadline(10, request, undefined, hang),
    (error: unknown) =>
      error instanceof RequestTimeoutError &&
      error.message === t('api.timedOut') &&
      error.request.method === 'POST' &&
      error.request.path === '/api/app/timer/resume',
  );
});

test('a cancel by the caller keeps its own error, so a cancelled query is not reported as timed out', async () => {
  const controller = new AbortController();
  const pending = withDeadline(60_000, request, controller.signal, hang);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
});

test('a reply within the deadline passes through, and so does a failure of its own', async () => {
  assert.equal(await withDeadline(60_000, request, undefined, () => Promise.resolve('ok')), 'ok');
  const failure = new TypeError('Failed to fetch');
  await assert.rejects(
    withDeadline(60_000, request, undefined, () => Promise.reject(failure)),
    (error: unknown) => error === failure,
  );
});

test('reads, writes and uploads get their own deadlines, and a caller can name one', () => {
  assert.equal(requestKind('GET', undefined), 'read');
  assert.equal(requestKind('POST', { revision: 3 }), 'write');
  assert.equal(requestKind('DELETE', undefined), 'write');
  assert.equal(requestKind('POST', rawBody('a,b', 'text/csv')), 'transfer');
  assert.equal(requestKind('POST', { range: 'week' }, 'read'), 'read', 'a report query is a read');
  assert.ok(DEADLINE_MS.read <= DEADLINE_MS.write && DEADLINE_MS.write < DEADLINE_MS.transfer);
});

test("a query's cancel signal reaches fetch, and the deadline rides along", async t => {
  const seen: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', (_path: string, init: RequestInit) => {
    seen.push(init.signal!);
    return hang(init.signal!);
  });
  const controller = new AbortController();
  const pending = api.get('/api/app/timer', { signal: controller.signal });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.aborted, false);
  controller.abort();
  assert.equal(seen[0]!.aborted, true);
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');

  // Without a caller signal, fetch still gets one: the deadline's.
  void api.post('/api/app/timer/pause').catch(() => {});
  assert.ok(seen[1] instanceof AbortSignal);
});
