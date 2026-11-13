import { test, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import express, { type Response } from 'express';
import type { Storage, TransactionContext } from '../src/domain/ports.ts';
import { errorHandler } from '../src/http/errors.ts';
import { RequestCancelled, forbidden } from '../src/lib/errors.ts';
import { silentLogger } from '../src/lib/logger.ts';
import { importRoutes } from '../src/routes/imports.ts';
import { createImportAdmission } from '../src/services/importAdmission.ts';
import { ImportDeadlineExceeded } from '../src/services/importGuards.ts';
import { createImportOperations } from '../src/services/importJson.ts';
import { importLimit } from '../src/services/importPolicy.ts';
import { createTimerPublication } from '../src/services/timerDelivery.ts';
import { openDatabase, storageFor, type FixtureDatabase } from './fixtures/database.ts';
import { importTableRows } from './fixtures/physical.ts';
import { entryAccount } from './storage/support/entry-timer.ts';
import { until } from './helpers.ts';

const DEADLINE_MESSAGE = 'The import took too long; split the file and try again';

/** Holds the event loop, as a record whose queries run on a synchronous driver does. */
function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end);
}

function jsonFile(entries: number): string {
  return JSON.stringify({
    format: 'tokkl-export',
    clients: [{ id: 1, name: 'ACME' }],
    time_entries: Array.from({ length: entries }, (_, i) => ({
      id: i + 1,
      start: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      stop: new Date(Date.UTC(2026, 9, 1, 0, i, 30)).toISOString(),
      description: `entry ${i}`,
    })),
  });
}

function csvFile(rows: number): string {
  return [
    'Description,Start date,Start time,Duration',
    ...Array.from({ length: rows }, (_, i) => `row ${i},2026-10-01,${String(i % 24).padStart(2, '0')}:00:00,00:01:00`),
  ].join('\n');
}

interface ImportRun {
  /** `performance.now()` when the import's signal aborted. */
  abortedAt?: number;
  /** `performance.now()` once the transaction rolled back or committed, and how it ended. */
  settled: Promise<{ at: number; error?: unknown }>;
}

type RecordHook = () => void | Promise<void>;

/** Runs `record` inside each record's savepoint, before its duplicate check: JSON entries and CSV rows. */
function slowedRunner(storage: Storage, record: { hook?: RecordHook; calls: number }) {
  return {
    transaction<T>(work: (ctx: TransactionContext) => Promise<T>, options?: { dryRun?: boolean }) {
      return storage.transaction(ctx => {
        const findDuplicate: TransactionContext['entries']['findDuplicate'] = async key => {
          record.calls++;
          await record.hook?.();
          return ctx.entries.findDuplicate(key);
        };
        return work({ ...ctx, entries: { ...ctx.entries, findDuplicate } });
      }, options);
    },
  };
}

/** Never refuses; the start limit has its own tests. */
const unlimited = { attempt: async () => ({ refused: false, valid: false }) };

/** The import routes over real storage, one place in all, and the account named in `x-user`. */
async function importServer(t: NodeTestContext, db: FixtureDatabase, options: { processingDeadlineMs?: number } = {}) {
  const storage = storageFor(db);
  const record: { hook?: RecordHook; calls: number } = { calls: 0 };
  const runner = slowedRunner(storage, record);
  const publish = createTimerPublication(async () => {}).publish;
  const admission = createImportAdmission({ maxImports: 1, maxPerUser: 1 });
  const runs: ImportRun[] = [];
  const responses: Response[] = [];
  const track = <T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> => {
    const run: ImportRun = {
      settled: work.then(
        () => ({ at: performance.now() }),
        error => ({ at: performance.now(), error }),
      ),
    };
    signal?.addEventListener('abort', () => (run.abortedAt = performance.now()), { once: true });
    runs.push(run);
    return work;
  };
  const app = express();
  // As in app.ts: the signal aborts when the response closes.
  app.use((_req, res, next) => {
    const controller = new AbortController();
    res.locals.workSignal = controller.signal;
    res.once('close', () => controller.abort());
    responses.push(res);
    next();
  });
  app.get('/ping', (_req, res) => {
    res.json('pong');
  });
  const requireAuth: express.RequestHandler = (req, res, next) => {
    const id = Number(req.headers['x-user']);
    if (!id) return next(forbidden('Incorrect username and/or password'));
    res.locals.auth = { user: { id, createdAt: '' } } as never;
    next();
  };
  const deps = {
    auth: { requireAuth },
    importAdmission: admission,
    importsFor: (auth: { user: { id: number } }) => {
      const imports = createImportOperations(runner, auth.user.id, publish);
      return {
        importJsonExport: (data: unknown, o: Parameters<typeof imports.importJsonExport>[1]) =>
          track(o.signal, imports.importJsonExport(data, o)),
        importTogglCsv: (text: string, o: Parameters<typeof imports.importTogglCsv>[1]) =>
          track(o.signal, imports.importTogglCsv(text, o)),
      };
    },
    importLimiter: unlimited,
  } as unknown as Parameters<typeof importRoutes>[0];
  app.use(importRoutes(deps, options));
  app.use(errorHandler(silentLogger));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  });
  const placeIsFree = (userId: number) => {
    try {
      admission.admit(userId, 0).release();
      return true;
    } catch {
      return false;
    }
  };
  return { port: (server.address() as AddressInfo).port, record, runs, responses, placeIsFree };
}

interface Reply {
  status: number;
  body: unknown;
  headers: IncomingHttpHeaders;
  at: number;
}

function post(port: number, path: string, body: string, user: number) {
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path,
    headers: { 'x-user': user, 'content-length': Buffer.byteLength(body) },
  });
  const response = new Promise<Reply>((resolve, reject) => {
    req.once('response', (res: IncomingMessage) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (text += chunk));
      res.once('end', () =>
        resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers, at: performance.now() }),
      );
      res.once('error', reject);
    });
    req.on('error', reject);
  });
  response.catch(() => {});
  req.end(body);
  return { req, response };
}

async function ping(port: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/ping`);
  assert.equal(await res.json(), 'pong');
  return performance.now();
}

async function account(db: FixtureDatabase, name: string): Promise<number> {
  return (await storageFor(db).transaction(ctx => ctx.users.createAccount(entryAccount(name)))).id;
}

const KINDS = [
  ['/import/json', jsonFile],
  ['/import/toggl-csv', csvFile],
] as const;

test('an import past its processing deadline answers 503 with Retry-After and changes nothing', async t => {
  const db = await openDatabase();
  const { port, record, runs } = await importServer(t, db, { processingDeadlineMs: 100 });
  // Each record holds the event loop, so the import notices the deadline only where it yields.
  record.hook = () => busy(4);
  for (const [path, file] of KINDS) {
    const user = await account(db, `late-${path.slice(8)}`);
    const before = await importTableRows(db);
    record.calls = 0;
    const reply = await post(port, path, file(150), user).response;
    assert.deepEqual([reply.status, reply.body, reply.headers['retry-after']], [503, DEADLINE_MESSAGE, '60'], path);
    const { error } = await runs.at(-1)!.settled;
    assert.ok(error instanceof ImportDeadlineExceeded, path);
    assert.ok(record.calls < 150, `${path} stopped after ${record.calls} records`);
    assert.deepEqual(await importTableRows(db), before, path);
  }
});

test('a client that leaves mid-import gets no reply, and the import rolls back whole', async t => {
  const db = await openDatabase();
  const { port, record, runs, responses } = await importServer(t, db);
  record.hook = () => sleep(2);
  for (const [path, file] of KINDS) {
    const user = await account(db, `gone-${path.slice(8)}`);
    const before = await importTableRows(db);
    record.calls = 0;
    const gone = post(port, path, file(200), user);
    await until(() => record.calls >= 10, 'ten records');
    gone.req.destroy();
    const { error } = await runs.at(-1)!.settled;
    assert.ok(error instanceof RequestCancelled, path);
    assert.ok(record.calls < 200, `${path} stopped after ${record.calls} records`);
    assert.deepEqual(await importTableRows(db), before, path);
    await sleep(20);
    assert.equal(responses.at(-1)!.headersSent, false, path);
  }
});

test('an import yields between records, so timers and other clients make progress while it runs', async t => {
  const db = await openDatabase();
  const { port, record } = await importServer(t, db);
  record.hook = () => busy(2);
  for (const [path, file] of KINDS) {
    const user = await account(db, `fair-${path.slice(8)}`);
    record.calls = 0;
    let ticks = 0;
    const timer = setInterval(() => {
      if (record.calls > 0 && record.calls < 200) ticks++;
    }, 1);
    const running = post(port, path, file(200), user);
    await until(() => record.calls > 0, 'the first record');
    const answered = await ping(port);
    const reply = await running.response.finally(() => clearInterval(timer));
    assert.equal(reply.status, 200, path);
    assert.ok(answered < reply.at, `${path}: another client is answered before the import ends`);
    assert.ok(ticks >= 2, `${path}: a timer fired ${ticks} times during the import`);
  }
});

test('the deadline is cooperative: a slow query finishes, then the import rolls back, holding its place throughout', async t => {
  const db = await openDatabase();
  const deadlineMs = 150,
    queryMs = 600;
  const { port, record, runs, placeIsFree } = await importServer(t, db, { processingDeadlineMs: deadlineMs });
  const [slow, other] = [await account(db, 'slow'), await account(db, 'other')];
  const before = await importTableRows(db);
  record.hook = async () => {
    if (record.calls === 1) await sleep(queryMs);
  };
  const first = post(port, '/import/json', jsonFile(3), slow);
  await until(() => runs[0]?.abortedAt !== undefined, 'the deadline');
  // Past the deadline, but the query and the rollback still run: the place is still taken.
  const refused = await post(port, '/import/json', jsonFile(1), other).response;
  assert.deepEqual([refused.status, refused.body], [503, 'Too many imports are running']);
  const late = await first.response;
  assert.deepEqual([late.status, late.body], [503, DEADLINE_MESSAGE]);
  const settled = await runs[0]!.settled;
  assert.ok(settled.error instanceof ImportDeadlineExceeded);
  assert.ok(refused.at < settled.at, 'refused while the import was still rolling back');
  const gap = settled.at - runs[0]!.abortedAt!;
  t.diagnostic(`deadline expiry to rollback completion: ${gap.toFixed(0)} ms`);
  assert.ok(gap >= queryMs - deadlineMs - 50, `the running query was not cut short (${gap.toFixed(0)} ms)`);
  assert.deepEqual(await importTableRows(db), before);
  await until(() => placeIsFree(other), 'the place');
  assert.equal((await post(port, '/import/json', jsonFile(1), other).response).status, 200);
});

test('a terminal failure inside a record ends the whole import instead of being reported as the record', async t => {
  const db = await openDatabase();
  const { port, record, runs } = await importServer(t, db);
  const terminal = [
    () => new RequestCancelled('Import cancelled'),
    () => new ImportDeadlineExceeded(),
    () => importLimit('At most 1 record'),
  ];
  for (const [path, file] of KINDS)
    for (const [index, failure] of terminal.entries()) {
      const user = await account(db, `terminal-${path.slice(8)}-${index}`);
      const before = await importTableRows(db);
      record.calls = 0;
      record.hook = () => {
        if (record.calls === 2) throw failure();
      };
      const started = runs.length;
      const reply = post(port, path, file(5), user).response;
      await until(() => runs.length > started, 'the import');
      const { error } = await runs.at(-1)!.settled;
      const expected = failure();
      assert.equal((error as Error).constructor, expected.constructor, `${path} ${index}`);
      assert.equal((error as Error).message, expected.message, `${path} ${index}`);
      assert.notEqual((await reply).status, 200, `${path} ${index}`);
      assert.deepEqual(await importTableRows(db), before, `${path} ${index}`);
    }
});
