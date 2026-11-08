import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportUnlessCancelled, startCancellable } from './useUnmountSignal.ts';

test('a failure of work the view cancelled is not reported', async () => {
  const controller = new AbortController();
  const reported: unknown[] = [];
  const done = reportUnlessCancelled(
    controller.signal,
    signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    error => reported.push(error),
  );
  controller.abort();
  await done;
  assert.deepEqual(reported, []);
});

test('a failure while the view is still there is reported', async () => {
  const refused = new Error('Download took too long');
  const reported: unknown[] = [];
  await reportUnlessCancelled(
    new AbortController().signal,
    () => Promise.reject(refused),
    error => reported.push(error),
  );
  assert.deepEqual(reported, [refused]);
});

/** Work that runs until `signal` aborts, then fails with its reason, as a download does. */
const untilAborted = (signal: AbortSignal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

test('a download the user cancels stops, and its failure is not reported', async () => {
  const view = new AbortController();
  const run = startCancellable(view.signal);
  const reported: unknown[] = [];
  const done = reportUnlessCancelled(run.signal, untilAborted, error => reported.push(error));
  run.cancel();
  await done;
  assert.equal(run.signal.aborted, true);
  assert.equal(view.signal.aborted, false, 'the view stays');
  assert.deepEqual(reported, []);
});

test('a cancellable run stops when the view goes away too, and a cancel reaches only its own run', () => {
  const view = new AbortController();
  const first = startCancellable(view.signal);
  const second = startCancellable(view.signal);
  first.cancel();
  assert.equal(second.signal.aborted, false);
  view.abort();
  assert.equal(second.signal.aborted, true);
});
