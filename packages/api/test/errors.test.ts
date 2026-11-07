import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorReply } from '../src/http/errors.ts';
import {
  conflict,
  forbidden,
  invalidInput,
  notFound,
  StateConflict,
  tooManyAttempts,
  unavailable,
} from '../src/lib/errors.ts';

test('each application failure kind answers its status, message and retry delay', () => {
  assert.deepEqual(errorReply(invalidInput('Bad')), { status: 400, headers: {}, body: 'Bad' });
  assert.deepEqual(errorReply(forbidden('No')), { status: 403, headers: {}, body: 'No' });
  assert.deepEqual(errorReply(notFound('Gone')), { status: 404, headers: {}, body: 'Gone' });
  assert.deepEqual(errorReply(conflict('Taken')), { status: 409, headers: {}, body: 'Taken' });
  assert.deepEqual(errorReply(new StateConflict('Stale', { revision: 3 })), {
    status: 409,
    headers: {},
    body: { revision: 3 },
  });
  assert.deepEqual(errorReply(tooManyAttempts('Slow down', 17)), {
    status: 429,
    headers: { 'Retry-After': '17' },
    body: 'Slow down',
  });
  assert.deepEqual(errorReply(unavailable('Report queue is full', 2)), {
    status: 503,
    headers: { 'Retry-After': '2' },
    body: 'Report queue is full',
  });
});

test('framework errors keep their client status and anything else is a 500 that says nothing', () => {
  assert.deepEqual(errorReply(Object.assign(new Error('x'), { type: 'entity.too.large' })), {
    status: 413,
    headers: {},
    body: 'Request body too large',
  });
  assert.deepEqual(errorReply(Object.assign(new Error('x'), { type: 'entity.parse.failed' })), {
    status: 400,
    headers: {},
    body: 'Invalid request body',
  });
  assert.deepEqual(errorReply(Object.assign(new Error('Not Found'), { status: 404 })), {
    status: 404,
    headers: {},
    body: 'Not Found',
  });
  for (const error of [new Error('connect ECONNREFUSED 10.0.0.5:5432'), new RangeError('Invalid time value'), 'text'])
    assert.deepEqual(errorReply(error), { status: 500, headers: {}, body: 'Internal Server Error' });
});
