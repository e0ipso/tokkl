import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { errorHandler, errorReply } from '../src/http/errors.ts';
import type { Logger } from '../src/lib/logger.ts';
import { ReportRunner } from '../src/services/reportRunner.ts';
import {
  conflict,
  RequestCancelled,
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

/** A response stand-in that records what the handler wrote; `connected` decides whether its socket is open. */
function recordingResponse(connected: boolean) {
  const written: Array<{ status: number; body: unknown }> = [];
  let status = 0;
  const res = {
    headersSent: false,
    destroyed: !connected,
    socket: connected ? { destroyed: false } : null,
    locals: {},
    status(code: number) {
      status = code;
      return res;
    },
    set() {
      return res;
    },
    json(body: unknown) {
      written.push({ status, body });
      return res;
    },
  };
  return { res, written };
}

function recordingLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  const logger: Logger = {
    debug: message => lines.push({ level: 'debug', message }),
    info: message => lines.push({ level: 'info', message }),
    warn: message => lines.push({ level: 'warn', message }),
    error: message => lines.push({ level: 'error', message }),
    child: () => logger,
  };
  return { logger, lines };
}

test('a report cancelled because its client left is logged at debug and answers nothing', () => {
  const { logger, lines } = recordingLogger();
  const { res, written } = recordingResponse(false);
  let passedOn = false;
  errorHandler(logger)(new RequestCancelled('Report cancelled'), {} as Request, res as unknown as Response, () => {
    passedOn = true;
  });
  assert.deepEqual(written, []);
  assert.equal(passedOn, false);
  assert.deepEqual(lines, [{ level: 'debug', message: 'Request cancelled' }]);
});

test('a cancellation while the client is still connected answers as before', () => {
  const { logger, lines } = recordingLogger();
  const { res, written } = recordingResponse(true);
  errorHandler(logger)(new RequestCancelled('Report cancelled'), {} as Request, res as unknown as Response, () => {});
  assert.deepEqual(written, [{ status: 500, body: 'Internal Server Error' }]);
  assert.deepEqual(lines, [{ level: 'error', message: 'Request failed' }]);
});

test('the report runner refuses an aborted request with a cancellation, not a failure', async () => {
  const runner = new ReportRunner(
    { backend: 'sqlite', filename: ':memory:', busyTimeoutMs: 5000 },
    {
      readSnapshot: () => Promise.reject(new Error('unused')),
    },
  );
  const signal = AbortSignal.abort();
  await assert.rejects(
    runner.run(
      1,
      1,
      { kind: 'v3-weekly', filter: { startDate: '2026-01-01', endDate: '2026-01-07' }, weekStart: '2026-01-01' },
      { signal },
    ),
    error => error instanceof RequestCancelled && error.message === 'Report cancelled',
  );
  await runner.close();
});
