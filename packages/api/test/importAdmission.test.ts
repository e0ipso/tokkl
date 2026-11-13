import { test, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { errorHandler } from '../src/http/errors.ts';
import { ApplicationError, RequestCancelled, forbidden } from '../src/lib/errors.ts';
import { silentLogger } from '../src/lib/logger.ts';
import { importRoutes } from '../src/routes/imports.ts';
import { createImportAdmission } from '../src/services/importAdmission.ts';
import { importsById } from './fixtures/imports.ts';
import { createTimerPublication } from '../src/services/timerDelivery.ts';
import { initializeDatabase } from '../src/storage/migrations.ts';
import { createTransactionRunner } from '../src/storage/transactions.ts';
import { entryAccount, entryTimerFactory } from './storage/support/entry-timer.ts';
import { setup, type TestContext } from './helpers.ts';
import { entryCount } from './fixtures/observations.ts';

const BUSY_RETRY_SECONDS = 5;
const MiB = 1024 * 1024;
/** The import body limit, which is also the whole byte budget of an instance. */
const LIMIT = 8 * MiB;

const busy = (error: unknown) =>
  error instanceof ApplicationError &&
  error.kind === 'unavailable' &&
  error.message === 'Too many imports are running' &&
  error.retryAfterSeconds === BUSY_RETRY_SECONDS;

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

test('import admission never lets the running files pass the byte budget', () => {
  const admission = createImportAdmission({ maxImports: 4, maxPerUser: 1, maxBytes: LIMIT });
  const first = admission.admit(1, 5 * MiB);
  assert.throws(() => admission.admit(2, 5 * MiB), busy, 'two 5 MiB files never run together');
  const small = admission.admit(2, 3 * MiB);
  assert.throws(() => admission.admit(3, 1), busy, 'the running files fill the byte budget');
  first.release();
  small.release();
  assert.throws(() => admission.admit(4, LIMIT + 1), busy, 'a file over the budget is refused even when alone');
  assert.throws(() => admission.admit(1, -1), /Invalid import size/);
  assert.throws(() => createImportAdmission({ maxBytes: 0 }), /Invalid import byte limit/);
  const defaults = createImportAdmission();
  defaults.admit(1, LIMIT);
  assert.throws(() => defaults.admit(2, 1), busy, 'the default budget is one full upload');
});

/** The import routes with a real admission, stand-in imports, and the account named in `x-user`. */
async function importServer(t: NodeTestContext, options: { uploadDeadlineMs?: number } = {}) {
  const admission = createImportAdmission();
  const reserved: number[] = [];
  const app = express();
  app.use((_req, res, next) => {
    res.locals.workSignal = new AbortController().signal;
    next();
  });
  const requireAuth: express.RequestHandler = (req, res, next) => {
    const id = Number(req.headers['x-user']);
    if (!id) return next(forbidden('Incorrect username and/or password'));
    res.locals.auth = { user: { id } } as never;
    next();
  };
  const deps = {
    auth: { requireAuth },
    importAdmission: {
      admit: (userId: number, bytes: number) => {
        const place = admission.admit(userId, bytes);
        reserved.push(bytes);
        return place;
      },
    },
    importsFor: () => ({
      importJsonExport: async () => ({ imported: 'json' }),
      importTogglCsv: async () => ({ imported: 'csv' }),
    }),
  } as unknown as Parameters<typeof importRoutes>[0];
  app.use(importRoutes(deps, options));
  app.use(errorHandler(silentLogger));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { port: (server.address() as AddressInfo).port, reserved };
}

interface Reply {
  status: number;
  body: unknown;
  headers: IncomingHttpHeaders;
}

/** Sends the headers and `sent`, then keeps the request open; without a length the body is chunked. */
function upload(port: number, path: string, headers: Record<string, string | number>, sent = '') {
  const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers });
  const response = new Promise<Reply>((resolve, reject) => {
    req.once('response', (res: IncomingMessage) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (text += chunk));
      res.once('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers }));
      res.once('error', reject);
    });
    req.on('error', reject);
  });
  response.catch(() => {});
  req.flushHeaders();
  if (sent) req.write(sent);
  return { req, response };
}

function send(port: number, path: string, body: string, user: number): Promise<Reply> {
  const request = upload(port, path, { 'x-user': user, 'content-length': Buffer.byteLength(body) });
  request.req.end(body);
  return request.response;
}

async function until(done: () => boolean) {
  for (let tries = 0; !done(); tries++) {
    if (tries > 200) throw new Error('Timed out waiting');
    await sleep(10);
  }
}

const IMPORT_PATHS = [
  '/import/json',
  '/import/json?dry_run=true',
  '/import/toggl-csv',
  '/import/toggl-csv?dry_run=true',
];

test('an import is refused before it takes a place when unsigned, encoded or declared too large', async t => {
  const { port, reserved } = await importServer(t);
  for (const path of IMPORT_PATHS) {
    // No body byte is sent in any of these.
    const anonymous = upload(port, path, { 'content-length': 5 * MiB });
    const gzip = upload(port, path, { 'x-user': 1, 'content-length': 5 * MiB, 'content-encoding': 'gzip' });
    const oversized = upload(port, path, { 'x-user': 2, 'content-length': LIMIT + 1 });
    const replies = await Promise.all([anonymous.response, gzip.response, oversized.response]);
    assert.deepEqual(
      replies.map(reply => [reply.status, reply.body, reply.headers['cache-control']]),
      [
        [403, 'Incorrect username and/or password', 'no-store'],
        [415, 'Unsupported content encoding', 'no-store'],
        [413, 'Request body too large', 'no-store'],
      ],
      path,
    );
    for (const { req } of [anonymous, gzip, oversized]) req.destroy();
  }
  assert.deepEqual(reserved, []);
});

test('an upload without a length reserves the whole budget, and two 5 MiB uploads never run together', async t => {
  const { port, reserved } = await importServer(t);
  for (const path of IMPORT_PATHS) {
    const chunked = upload(port, path, { 'x-user': 1, 'transfer-encoding': 'chunked' }, '"x');
    await until(() => reserved.length === 1);
    assert.deepEqual(reserved, [LIMIT], path);
    const small = await send(port, path, '""', 2);
    assert.deepEqual([small.status, small.headers['retry-after']], [503, String(BUSY_RETRY_SECONDS)], path);
    chunked.req.end('"');
    assert.equal((await chunked.response).status, 200, path);
    reserved.length = 0;
  }
  const file = `"${'x'.repeat(5 * MiB - 2)}"`;
  const first = upload(port, '/import/json', { 'x-user': 1, 'content-length': file.length }, file.slice(0, 10));
  await until(() => reserved.length === 1);
  const second = await send(port, '/import/toggl-csv?dry_run=true', file, 2);
  assert.deepEqual([second.status, second.headers['retry-after']], [503, String(BUSY_RETRY_SECONDS)]);
  first.req.end(file.slice(10));
  assert.deepEqual((await first.response).body, { imported: 'json' });
  assert.deepEqual((await send(port, '/import/toggl-csv?dry_run=true', file, 2)).body, { imported: 'csv' });
  assert.deepEqual(reserved, [5 * MiB, 5 * MiB]);
});

test('a place comes back after a parser failure, a client disconnect and an upload past its deadline', async t => {
  const { port, reserved } = await importServer(t, { uploadDeadlineMs: 300 });
  const chunked = (path: string, sent: string) =>
    upload(port, path, { 'x-user': 1, 'transfer-encoding': 'chunked' }, sent);
  /** A full-budget upload from the same account fits only once the last one gave its place back. */
  const placeIsFree = async (path: string) => {
    let reply: Reply | undefined;
    for (let tries = 0; reply?.status !== 200 && tries < 50; tries++) {
      if (reply) await sleep(20);
      const probe = chunked(path, '""');
      probe.req.end();
      reply = await probe.response;
    }
    assert.equal(reply?.status, 200, path);
  };
  for (const path of IMPORT_PATHS) {
    const overflowing = chunked(path, 'x'.repeat(LIMIT + 1));
    overflowing.req.end();
    assert.deepEqual((await overflowing.response).body, 'Request body too large', path);
    await placeIsFree(path);

    const admitted = reserved.length;
    const abandoned = chunked(path, '"x');
    await until(() => reserved.length > admitted);
    abandoned.req.destroy();
    await placeIsFree(path);

    // Bytes that keep coming do not extend the deadline; it counts from admission.
    const stalled = chunked(path, '"');
    const trickle = setInterval(() => stalled.req.write('x'), 50);
    const timedOut = await stalled.response.finally(() => clearInterval(trickle));
    assert.deepEqual([timedOut.status, timedOut.body], [408, 'The upload took too long'], path);
    if (!stalled.req.destroyed) await once(stalled.req, 'close');
    await placeIsFree(path);
  }
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
  const probe = await ctx.request('GET', '/api/app/status');
  const port = Number(new URL(probe.url).port);

  const first = slowImport(ctx, port, file);
  let second = await ctx.json('POST', '/api/app/import/json', file);
  for (let tries = 0; second.status !== 503 && tries < 50; tries++) {
    await sleep(20);
    second = await ctx.json('POST', '/api/app/import/json', file);
  }
  assert.equal(second.status, 503);
  assert.equal(second.body, 'Too many imports are running');
  assert.equal(second.headers.get('retry-after'), String(BUSY_RETRY_SECONDS));
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

/** Reads as aborted from its `at`-th check on, counting every check. */
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
  const imports = importsById(runner, createTimerPublication(async () => {}).publish);
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
