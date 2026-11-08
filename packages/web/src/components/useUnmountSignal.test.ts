import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportUnlessCancelled } from './useUnmountSignal.ts';

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
