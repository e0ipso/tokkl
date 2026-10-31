import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyFailure, safeHistoryError, withHistoryCleanup } from './history-errors.ts';

test('a request timeout remains the primary failure when awaited API cleanup also fails', async () => {
  const request = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const shutdown = new Error('Benchmark API did not shut down cleanly');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const result = withHistoryCleanup(async () => { throw request; }, async () => { await waiting; throw shutdown; });
  const observed = result.then(() => { settled = true; }, error => { settled = true; return error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  const error = await observed;
  assert.equal(error.operation?.name, 'TimeoutError');
  assert.equal(error.cleanup?.status, 'failed');
  assert.equal(error.cleanup?.error?.message, shutdown.message);
});

test('failure artifacts retain request status and cause, successful cleanup and no raw secret fields', async () => {
  const cause = Object.assign(new Error('connect mysql://user:private-password@host/db'), { code: 'ECONNRESET' });
  const request = Object.assign(new Error('POST /api/app/import/json answered 503'), { name: 'HTTPError', status: 503, cause, body: 'private-body', authorization: 'private-auth' });
  let stopped = false;
  const error = await withHistoryCleanup(async () => { throw request; }, async () => { stopped = true; }).catch(error => error);
  const serialized = JSON.parse(JSON.stringify(historyFailure(error)));
  assert.equal(stopped, true);
  assert.equal(serialized.operation.name, 'HTTPError');
  assert.equal(serialized.operation.status, 503);
  assert.equal(serialized.operation.cause.code, 'ECONNRESET');
  assert.equal(serialized.cleanup.status, 'succeeded');
  assert.equal(/private-|mysql:\/\//.test(JSON.stringify(serialized)), false);
  assert.equal(/secret/.test(JSON.stringify(safeHistoryError(new Error('password=secret; api_token: secret; authorization=secret')))), false);
});

test('cleanup-only failures fail the run, successful values survive, and non-Error/cyclic causes serialize safely', async () => {
  assert.equal(await withHistoryCleanup(async () => 42, async () => {}), 42);
  const failure = await withHistoryCleanup(async () => 42, async () => { throw new Error('fixture cleanup failed'); }).catch(error => error);
  assert.equal(historyFailure(failure).operation, undefined);
  assert.equal(historyFailure(failure).cleanup.status, 'failed');
  const cyclic = new Error('connect failed');
  cyclic.cause = cyclic;
  assert.doesNotThrow(() => JSON.stringify(safeHistoryError(cyclic)));
  const nonError = await withHistoryCleanup(async () => { throw undefined; }, async () => {}).catch(error => error);
  assert.equal(historyFailure(nonError).operation?.message, 'Benchmark operation failed');
});
