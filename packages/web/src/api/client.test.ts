import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  DEADLINE_MS,
  RequestTimeoutError,
  api,
  fetchDownload,
  rawBody,
  requestKind,
  withDeadline,
} from './client.ts';
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
  const pending = api.get('/api/app/timer', { signal: controller.signal, decode: value => value });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.aborted, false);
  controller.abort();
  assert.equal(seen[0]!.aborted, true);
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');

  // Without a caller signal, fetch still gets one: the deadline's.
  void api.post('/api/app/timer/pause').catch(() => {});
  assert.ok(seen[1] instanceof AbortSignal);
});

/**
 * A fetch that answers with `pieces`, one every `everyMs`, then ends the body, or holds it open if
 * `end` is false. As with a real fetch, an abort errors the body.
 */
function streaming(pieces: string[], everyMs: number, end = true) {
  return (_path: string, init: RequestInit) => {
    const signal = init.signal!;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timers: Array<ReturnType<typeof setTimeout>> = [];
        signal.addEventListener('abort', () => {
          for (const timer of timers) clearTimeout(timer);
          controller.error(signal.reason);
        });
        pieces.forEach((piece, index) =>
          timers.push(setTimeout(() => controller.enqueue(new TextEncoder().encode(piece)), everyMs * (index + 1))),
        );
        if (end) timers.push(setTimeout(() => controller.close(), everyMs * (pieces.length + 1)));
      },
    });
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/csv' } }));
  };
}

const exportPath = '/api/app/export.csv';

test('a download takes as long as its body keeps coming, past the deadline for its reply to start', async t => {
  t.mock.method(globalThis, 'fetch', streaming(['a,', 'b,', 'c,', 'd,', 'e,', 'f'], 20));
  // The body takes 140 ms, more than twice the 50 ms its reply had to start in.
  const blob = await fetchDownload(exportPath, {}, { start: 50, stall: 100 });
  assert.equal(await blob.text(), 'a,b,c,d,e,f');
  assert.equal(blob.type, 'text/csv');
});

test('a download whose body stops coming fails as timed out', async t => {
  t.mock.method(globalThis, 'fetch', streaming(['a,', 'b,'], 5, false));
  await assert.rejects(
    fetchDownload(exportPath, {}, { start: 1000, stall: 30 }),
    (error: unknown) => error instanceof RequestTimeoutError && error.request.path === exportPath,
  );
});

test('a download whose reply never starts fails as timed out', async t => {
  t.mock.method(globalThis, 'fetch', (_path: string, init: RequestInit) => hang(init.signal!));
  await assert.rejects(
    fetchDownload(exportPath, { method: 'POST', body: {} }, { start: 20, stall: 1000 }),
    (error: unknown) => error instanceof RequestTimeoutError && error.request.method === 'POST',
  );
});

test("a refused download fails with the server's message", async t => {
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response(JSON.stringify('Download took too long'), { status: 503 })),
  );
  await assert.rejects(
    fetchDownload(exportPath),
    (error: unknown) => error instanceof ApiError && error.status === 503 && error.message === 'Download took too long',
  );
});
