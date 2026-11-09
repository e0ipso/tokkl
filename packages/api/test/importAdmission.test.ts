import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { errorHandler } from '../src/http/errors.ts';
import { ApplicationError, RequestCancelled, unavailable } from '../src/lib/errors.ts';
import { silentLogger } from '../src/lib/logger.ts';
import { importRoutes } from '../src/routes/imports.ts';
import { createImportAdmission, IMPORT_BUSY_RETRY_SECONDS } from '../src/services/importAdmission.ts';
import { importsById } from './fixtures/imports.ts';
import { createTimerPublication } from '../src/services/timerPublication.ts';
import { initializeDatabase } from '../src/storage/migrations.ts';
import { createTransactionRunner } from '../src/storage/transactions.ts';
import { entryAccount, entryTimerFactory } from './storage/support/entry-timer.ts';
import { setup, type TestContext } from './helpers.ts';
import { entryCount } from './fixtures/observations.ts';

const busy = (error: unknown) =>
  error instanceof ApplicationError &&
  error.kind === 'unavailable' &&
  error.message === 'Too many imports are running' &&
  error.retryAfterSeconds === IMPORT_BUSY_RETRY_SECONDS;

test('import admission bounds imports in all and per account', () => {
  const admission = createImportAdmission({ maxImports: 2, maxPerUser: 1 });
  const first = admission.admit(1, 1);
  assert.throws(() => admission.admit(1, 1), busy);
  const second = admission.admit(2, 1);
  assert.throws(() => admission.admit(3, 1), busy);
  first.release();
  first.release();
  const third = admission.admit(3, 1);
  assert.throws(() => admission.admit(4, 1), busy);
  second.release();
  third.release();
  admission.admit(1, 1);
  assert.throws(() => createImportAdmission({ maxImports: 1, maxPerUser: 2 }), /Invalid import limit per account/);
  assert.throws(() => createImportAdmission({ maxImports: 0 }), /Invalid import limit/);
});

test('import admission counts file bytes as well as imports', () => {
  const MB = 1024 * 1024;
  const admission = createImportAdmission({ maxImports: 4, maxPerUser: 1, maxBytes: 64 * MB });
  const large = admission.admit(1, 50 * MB);
  assert.throws(() => admission.admit(2, 40 * MB), busy, 'two large files never run together');
  const small = admission.admit(2, 10 * MB);
  assert.throws(() => admission.admit(3, 5 * MB), busy, 'the running files fill the byte budget');
  admission.admit(3, 4 * MB).release();
  large.release();
  const next = admission.admit(4, 40 * MB);
  small.release();
  next.release();
  // Alone, a file larger than the budget still gets in, so every file within the body limit can run.
  const alone = admission.admit(5, 80 * MB);
  assert.throws(() => admission.admit(6, 1), busy);
  alone.release();
  assert.throws(() => admission.admit(1, -1), /Invalid import size/);
  assert.throws(() => createImportAdmission({ maxBytes: 0 }), /Invalid import byte limit/);
});

test('an import is admitted with its declared length, or the body limit when it declares none', async t => {
  const admitted: number[] = [];
  const app = express();
  app.use((_req, res, next) => {
    res.locals.auth = { user: { id: 1 } } as never;
    res.locals.workSignal = new AbortController().signal;
    next();
  });
  app.use(
    importRoutes({
      auth: { requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() },
      importAdmission: {
        admit: (_userId: number, bytes: number) => {
          admitted.push(bytes);
          throw unavailable('Too many imports are running', IMPORT_BUSY_RETRY_SECONDS);
        },
      },
      importsFor: () => {
        throw new Error('unused');
      },
    } as unknown as Parameters<typeof importRoutes>[0]),
  );
  app.use(errorHandler(silentLogger));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/import/json`;
  const sized = await fetch(url, { method: 'POST', body: '{"format":"tokkl-export"}' });
  assert.equal(sized.status, 503);
  assert.equal(sized.headers.get('retry-after'), String(IMPORT_BUSY_RETRY_SECONDS));
  // A streamed body is sent chunked, without a length.
  const chunked = await fetch(url, {
    method: 'POST',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
  assert.equal(chunked.status, 503);
  assert.deepEqual(admitted, [Buffer.byteLength('{"format":"tokkl-export"}'), 50 * 1024 * 1024]);
});

test('a place lent to work stays taken until the work settles', async () => {
  const admission = createImportAdmission({ maxImports: 1, maxPerUser: 1 });
  const place = admission.admit(1, 1);
  let finish!: () => void;
  const work = place.during(new Promise<void>(resolve => (finish = resolve)));
  // The request ended, but its transaction still runs.
  place.release();
  assert.throws(() => admission.admit(2, 1), busy);
  finish();
  await work;
  admission.admit(2, 1).release();
  const failing = admission.admit(1, 1);
  await assert.rejects(failing.during(Promise.reject(new Error('rolled back'))), /rolled back/);
  failing.release();
  admission.admit(1, 1);
});

/** An import body sent in two parts, the second only when the test says so. */
function slowImport(ctx: TestContext, port: number, body: string) {
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/api/app/import/json',
    headers: {
      authorization: `Basic ${Buffer.from(`${ctx.user.apiToken}:api_token`).toString('base64')}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  });
  const response = once(req, 'response').then(([res]) => res as import('node:http').IncomingMessage);
  req.write(body.slice(0, 10));
  return {
    req,
    response,
    finish: () => req.end(body.slice(10)),
  };
}

test('a second import from one account gets 503 with Retry-After while the first runs', async () => {
  const ctx = await setup();
  const file = JSON.stringify({
    format: 'tokkl-export',
    time_entries: [{ id: 1, start: '2026-10-05T09:00:00Z', stop: '2026-10-05T10:00:00Z', description: 'held' }],
  });
  // The fixture server's port: a plain request finds it.
  const probe = await ctx.request('GET', '/api/app/status');
  const port = Number(new URL(probe.url).port);

  const first = slowImport(ctx, port, file);
  // The first request has its place once the server read its headers.
  let second = await ctx.json('POST', '/api/app/import/json', file);
  for (let tries = 0; second.status !== 503 && tries < 50; tries++) {
    await sleep(20);
    second = await ctx.json('POST', '/api/app/import/json', file);
  }
  assert.equal(second.status, 503);
  assert.equal(second.body, 'Too many imports are running');
  assert.equal(second.headers.get('retry-after'), String(IMPORT_BUSY_RETRY_SECONDS));
  const csv = await ctx.request('POST', '/api/app/import/toggl-csv', 'x', { 'content-type': 'text/csv' });
  assert.equal(csv.status, 503);

  first.finish();
  const done = await first.response;
  done.resume();
  assert.equal(done.statusCode, 200);
  await once(done, 'end');
  let third = await ctx.json('POST', '/api/app/import/json', file);
  for (let tries = 0; third.status === 503 && tries < 50; tries++) {
    await sleep(20);
    third = await ctx.json('POST', '/api/app/import/json', file);
  }
  assert.equal(third.status, 200);
  assert.equal(third.body.skipped_duplicates, 1);
  assert.equal(await entryCount(ctx), 1);

  // A client that gives up before its body arrives frees its place.
  const abandoned = slowImport(ctx, port, file);
  abandoned.response.catch(() => {});
  await sleep(50);
  abandoned.req.destroy();
  let after = await ctx.json('POST', '/api/app/import/json', file);
  for (let tries = 0; after.status === 503 && tries < 50; tries++) {
    await sleep(20);
    after = await ctx.json('POST', '/api/app/import/json', file);
  }
  assert.equal(after.status, 200);
});

/** A signal that reads as aborted from its `at`-th check on, counting every check. */
function abortsAt(at: number) {
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks >= at;
    },
  } as AbortSignal;
  return { signal, checks: () => checks };
}

const JSON_FILE = {
  format: 'tokkl-export',
  clients: [{ id: 1, name: 'ACME' }],
  projects: [{ id: 2, name: 'Website', client_id: 1 }],
  tags: [{ id: 3, name: 'deep' }],
  time_entries: Array.from({ length: 6 }, (_, i) => ({
    id: 10 + i,
    start: `2026-10-0${i + 1}T09:00:00Z`,
    stop: `2026-10-0${i + 1}T10:00:00Z`,
    description: `entry ${i}`,
    project_id: 2,
    tag_ids: [3],
  })),
};
const CSV_FILE = [
  'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags',
  ...Array.from(
    { length: 6 },
    (_, i) => `Me,me@example.com,ACME,Website,,row ${i},No,2026-10-0${i + 1},09:00:00,,,01:00:00,`,
  ),
].join('\n');

test('a cancelled import stops between records and before commit, and rolls back whole', async t => {
  const config = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
  const connection = await initializeDatabase(config);
  t.after(() => connection.close());
  const runner = createTransactionRunner(connection, entryTimerFactory('sqlite'));
  const imports = importsById(
    runner,
    createTimerPublication(async () => {}),
  );
  const stored = (userId: number) =>
    runner.readSnapshot(async r => ({
      entries: (await r.entries.list(userId)).length,
      clients: (await r.clients.list((await r.users.get(userId))!.defaultWorkspaceId)).length,
    }));
  const kinds = [
    [
      'json',
      (userId: number, signal: AbortSignal) => imports.importJsonExport(userId, JSON_FILE, { dryRun: false, signal }),
    ],
    [
      'csv',
      (userId: number, signal: AbortSignal) => imports.importTogglCsv(userId, CSV_FILE, { dryRun: false, signal }),
    ],
  ] as const;
  for (const [kind, run] of kinds) {
    // A run that is never cancelled counts the checks a whole import makes.
    const counted = await runner.transaction(r => r.users.createAccount(entryAccount(`${kind}-whole`)));
    const whole = abortsAt(Infinity);
    await run(counted.id, whole.signal);
    assert.equal((await stored(counted.id)).entries, 6, kind);
    const total = whole.checks();
    assert.ok(total > 8, `${kind} checks ${total} times`);
    // Before the transaction, between records, and at commit, after every record was written.
    for (const at of [1, 2, Math.floor(total / 2), total - 1, total]) {
      const user = await runner.transaction(r => r.users.createAccount(entryAccount(`${kind}-${at}`)));
      const cancelled = abortsAt(at);
      await assert.rejects(run(user.id, cancelled.signal), RequestCancelled, `${kind} at ${at}`);
      assert.equal(cancelled.checks(), at, `${kind} stops at its check ${at}`);
      assert.deepEqual(await stored(user.id), { entries: 0, clients: 0 }, `${kind} at ${at}`);
    }
  }
});
