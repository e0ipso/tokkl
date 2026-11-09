import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { openSQLiteDatabase, storageFor } from './fixtures/database.ts';
import { insertAccount } from './fixtures/domain.ts';
import type { Authentication } from '../src/domain/credentials.ts';
import { errorHandler } from '../src/http/errors.ts';
import { ApplicationError, RequestCancelled } from '../src/lib/errors.ts';
import { silentLogger } from '../src/lib/logger.ts';
import { appReportRoutes, reportsV3Routes } from '../src/routes/reports.ts';
import type { Deps } from '../src/routes/context.ts';
import { createApplicationServices } from '../src/services/application.ts';
import { ReportRunner, type ReportExecutor } from '../src/services/reportRunner.ts';
import { createApp } from '../src/app.ts';
import { testConfig, testServer } from './helpers.ts';
import { runReport, runExport } from './fixtures/reportRunner.ts';
import { fakeReportWorkers, postedJobs } from './fixtures/fakeReportWorker.ts';
import type { JobSource } from '../src/services/reportExecution.ts';
import type { Storage } from '../src/domain/ports.ts';

const INLINE = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
const WEEKLY = {
  kind: 'v3-weekly' as const,
  filter: { startDate: '2026-01-01', endDate: '2026-01-07' },
  weekStart: '2026-01-01',
};

const EXPORT = { kind: 'export-json' as const, exportedAt: '2026-01-01T00:00:00Z', filename: 'x' };

/**
 * A runner with one place in each lane, both taken by a report and an export that wait until the
 * test ends, so the next job of either kind finds its lane full.
 */
function fullRunner(t: TestContext): ReportRunner {
  let release!: () => void;
  const held = new Promise<void>(resolve => (release = resolve));
  const source: JobSource = {
    readSnapshot: async () => {
      await held;
      throw new Error('released');
    },
  };
  const runner = new ReportRunner(INLINE, source, { maxQueue: 1, downloads: { maxQueue: 1 } });
  const running = [
    runReport(runner, 1, 1, WEEKLY as never).catch(() => {}),
    runExport(runner, 1, EXPORT, async () => {}).catch(() => {}),
  ];
  t.after(async () => {
    release();
    await Promise.all(running);
    await runner.close();
  });
  return runner;
}

/** Settles with `promise`, or with 'pending' when it has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), ms))]);
}

test('an export that holds its download place does not hold up reports', async t => {
  let release!: () => void;
  const held = new Promise<void>(resolve => (release = resolve));
  let reads = 0;
  const reported = new ApplicationError('not-found', 'report read');
  // The first read is the export's, which waits like a client that stopped reading; reports fail at once.
  const source: JobSource = {
    readSnapshot: async () => {
      if (++reads === 1) {
        await held;
        throw new Error('released');
      }
      throw reported;
    },
  };
  const runner = new ReportRunner(INLINE, source);
  const exporting = runExport(runner, 1, EXPORT, async () => {}).catch(error => error);
  t.after(async () => {
    release();
    await exporting;
    await runner.close();
  });
  while (reads === 0) await new Promise(resolve => setImmediate(resolve));
  const report = runReport(runner, 2, 1, WEEKLY as never).then(
    () => 'answered',
    error => error,
  );
  assert.equal(await within(report, 2000), reported, 'the report ran while the export held its place');
});

test('a download that runs past its deadline is given up with a 503 and Retry-After', async t => {
  let release!: () => void;
  const held = new Promise<void>(resolve => (release = resolve));
  const source: JobSource = {
    readSnapshot: async () => {
      await held;
      throw new Error('released');
    },
  };
  const runner = new ReportRunner(INLINE, source, { downloads: { deadlineMs: 30 } });
  t.after(async () => {
    release();
    await runner.close();
  });
  const started = Date.now();
  await assert.rejects(
    runExport(runner, 1, EXPORT, async () => {}),
    error =>
      error instanceof ApplicationError &&
      error.kind === 'unavailable' &&
      error.message === 'Download took too long' &&
      error.retryAfterSeconds === 60,
  );
  assert.ok(Date.now() - started < 2000);
});

test('the download lane limits must be valid', () => {
  const source: JobSource = { readSnapshot: () => Promise.reject(new Error('unused')) };
  assert.throws(() => new ReportRunner(INLINE, source, { downloads: { maxQueue: 0 } }), /Invalid download queue/);
  assert.throws(
    () => new ReportRunner(INLINE, source, { downloads: { maxQueue: 4, maxPerUser: 5 } }),
    /Invalid download share/,
  );
  assert.throws(() => new ReportRunner(INLINE, source, { downloads: { deadlineMs: 0 } }), /Invalid download deadline/);
});

/** Storage that counts its read snapshots. */
function countingReads(storage: Storage): { storage: Storage; reads: () => number } {
  let reads = 0;
  return {
    storage: {
      ...storage,
      readSnapshot: work => {
        reads++;
        return storage.readSnapshot(work);
      },
    },
    reads: () => reads,
  };
}

test('a full download lane refuses an account export before reading it', async t => {
  const db = await openSQLiteDatabase();
  const counted = countingReads(storageFor(db));
  const services = createApplicationServices({ storage: counted.storage, reports: fullRunner(t), sessionDays: 30 });
  t.after(() => services.close());
  const user = await insertAccount(db, {
    email: 'export@example.test',
    fullname: 'Export',
    timezone: 'UTC',
    passwordHash: 'unused',
    role: 'user',
  });
  const authentication: Authentication = {
    user,
    credential: { kind: 'api-token', token: user.apiToken },
    authMethod: 'basic',
  };
  await assert.rejects(
    services.exportAccount(
      authentication,
      { kind: 'export-json', exportedAt: '2026-01-01T00:00:00Z', filename: 'x' },
      async () => {},
    ),
    error =>
      error instanceof ApplicationError &&
      error.kind === 'unavailable' &&
      error.message === 'Report queue is full' &&
      error.retryAfterSeconds === 2,
  );
  assert.equal(counted.reads(), 0);
});

test('a cancelled account export reads nothing', async t => {
  const db = await openSQLiteDatabase();
  const counted = countingReads(storageFor(db));
  const reports = new ReportRunner(INLINE, { readSnapshot: () => Promise.reject(new Error('unused')) });
  const services = createApplicationServices({ storage: counted.storage, reports, sessionDays: 30 });
  t.after(() => services.close());
  const user = await insertAccount(db, {
    email: 'cancel@example.test',
    fullname: 'Cancel',
    timezone: 'UTC',
    passwordHash: 'unused',
    role: 'user',
  });
  await assert.rejects(
    services.exportAccount(
      { user, credential: { kind: 'api-token', token: user.apiToken }, authMethod: 'basic' },
      { kind: 'export-json', exportedAt: '2026-01-01T00:00:00Z', filename: 'x' },
      async () => {},
      { signal: AbortSignal.abort() },
    ),
    error => error instanceof RequestCancelled,
  );
  assert.equal(counted.reads(), 0);
});

test('a full report queue answers a report request before it reads the workspace', async t => {
  let reads = 0;
  const user = { id: 1, defaultWorkspaceId: 1 };
  const deps = {
    auth: {
      requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
        res.locals.auth = { user } as never;
        next();
      },
    },
    readFor: async () => {
      reads++;
      return { id: 1, rounding: 0, roundingMinutes: 0 };
    },
    reports: fullRunner(t),
  } as unknown as Pick<Deps, 'auth' | 'readFor' | 'reports'>;
  const app = express();
  app.use(express.text({ type: '*/*' }));
  app.use((_req, res, next) => {
    res.locals.workSignal = new AbortController().signal;
    next();
  });
  app.use('/v3', reportsV3Routes(deps));
  app.use('/app', appReportRoutes(deps));
  app.use(errorHandler(silentLogger));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const path of ['/v3/workspace/1/search/time_entries', '/v3/workspace/1/weekly/time_entries', '/app/report']) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start_date: '2026-01-01', end_date: '2026-01-07' }),
    });
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(await response.json(), 'Report queue is full');
  }
  assert.equal(reads, 0);
});

test('a reserved place counts toward the queue limit until its holder queues a job or gives up', async t => {
  const runner = new ReportRunner(INLINE, { readSnapshot: () => Promise.reject(new Error('unused')) }, { maxQueue: 1 });
  t.after(() => runner.close());
  let release!: () => void;
  const preparing = runner.reserve({ userId: 1 }, () => new Promise<void>(resolve => (release = resolve)));
  await assert.rejects(
    runner.reserve({ userId: 2 }, async () => {}),
    /Report queue is full/,
  );
  release();
  await preparing;
  await assert.rejects(
    runner.reserve({ userId: 1 }, async () => {
      throw new Error('bad request');
    }),
    /bad request/,
  );
  assert.equal(await runner.reserve({ userId: 1 }, async () => 'free again'), 'free again');
  await assert.rejects(
    runner.reserve({ userId: 1 }, async slot => {
      await slot.run(1, WEEKLY as never).catch(() => {});
      return slot.run(1, WEEKLY as never);
    }),
    /A report slot queues one job/,
  );
});

/**
 * A report source whose snapshots wait, one gate per snapshot, and record the user each job reads
 * for. Every job then fails the credential lookup, which is all these tests need.
 */
function gatedSource() {
  const order: number[] = [];
  const gates: Array<() => void> = [];
  const source: JobSource = {
    readSnapshot: work =>
      work({
        users: {
          get: async (id: number) => {
            order.push(id);
            await new Promise<void>(resolve => gates.push(resolve));
            return undefined;
          },
        },
      } as never),
  };
  /** Waits until `count` jobs have started reading. */
  const reading = async (count: number) => {
    while (order.length < count) await new Promise(resolve => setImmediate(resolve));
  };
  return { source, order, reading, release: () => gates.shift()?.() };
}

test('one account cannot take more than its share of the report queue', async t => {
  const { source, reading, release } = gatedSource();
  const runner = new ReportRunner(INLINE, source, { maxQueue: 8, maxPerUser: 3 });
  t.after(() => runner.close());
  const mine = [1, 2, 3].map(() => runReport(runner, 1, 1, WEEKLY as never).catch(error => error));
  await reading(1);
  await assert.rejects(
    runReport(runner, 1, 1, WEEKLY as never),
    error =>
      error instanceof ApplicationError &&
      error.kind === 'unavailable' &&
      error.message === 'Report queue is full' &&
      error.retryAfterSeconds === 2,
  );
  // A place this account is still preparing counts toward its share too.
  await assert.rejects(
    runner.reserve({ userId: 1 }, async () => {}),
    /Report queue is full/,
  );
  const theirs = runReport(runner, 2, 2, WEEKLY as never).catch(error => error);
  for (let i = 0; i < 4; i++) {
    await reading(i + 1);
    release();
  }
  for (const result of await Promise.all([...mine, theirs])) assert.ok(result instanceof ApplicationError);
  // Once its jobs finish, the account has its whole share again.
  const again = [1, 2, 3].map(() => runReport(runner, 1, 1, WEEKLY as never).catch(error => error));
  for (let i = 4; i < 7; i++) {
    await reading(i + 1);
    release();
  }
  for (const result of await Promise.all(again)) assert.ok(result instanceof ApplicationError);
});

test('queued reports take turns between accounts', async t => {
  const { source, order, reading, release } = gatedSource();
  const runner = new ReportRunner(INLINE, source, { maxQueue: 16, maxPerUser: 4 });
  t.after(() => runner.close());
  const jobs = [
    ...[1, 1, 1, 1].map(user => runReport(runner, user, user, WEEKLY as never).catch(() => {})),
    ...[2, 2].map(user => runReport(runner, user, user, WEEKLY as never).catch(() => {})),
    runReport(runner, 3, 3, WEEKLY as never).catch(() => {}),
  ];
  for (let i = 0; i < jobs.length; i++) {
    await reading(i + 1);
    release();
  }
  await Promise.all(jobs);
  // Account 1 was running when the others queued; after it, each account takes the next turn.
  assert.deepEqual(order, [1, 2, 3, 1, 2, 1, 1]);
});

test('the per-account share must fit the queue', () => {
  const source: JobSource = { readSnapshot: () => Promise.reject(new Error('unused')) };
  for (const maxPerUser of [0, 1.5, 17])
    assert.throws(() => new ReportRunner(INLINE, source, { maxQueue: 16, maxPerUser }), /Invalid report share/);
});

/** A database the fake workers never open; any file-backed config runs jobs in workers. */
const WORKER = { backend: 'sqlite' as const, filename: 'unused.db', busyTimeoutMs: 5000 };
const UNUSED: JobSource = { readSnapshot: () => Promise.reject(new Error('unused')) };

test('a slot queues work only for the account that reserved it', async t => {
  const { startWorker, posted } = fakeReportWorkers();
  const runner = new ReportRunner(WORKER, UNUSED, { startWorker });
  t.after(() => runner.close());
  const output = async () => {};
  const jobs = [
    runner.reserve({ userId: 7 }, slot => slot.run(3, WEEKLY as never)),
    runner.reserveDownload({ userId: 7 }, slot => slot.export(EXPORT, output)),
    runner.reserveDownload({ userId: 7 }, slot =>
      slot.report(3, { kind: 'detailed-csv', filter: WEEKLY.filter } as never, output),
    ),
  ];
  for (const job of await postedJobs(posted, 3)) job.worker.finish(job.id);
  await Promise.all(jobs);
  assert.deepEqual(
    posted.map(job => job.work.userId),
    [7, 7, 7],
  );
});

/** Reports for `users`, one each, that settle with their error or undefined. */
const reportsFor = (runner: ReportRunner, users: number[]) =>
  users.map(user =>
    runReport(runner, user, 1, WEEKLY as never).then(
      () => undefined,
      (error: Error) => error,
    ),
  );
const exportsFor = (runner: ReportRunner, users: number[]) =>
  users.map(user =>
    runExport(runner, user, EXPORT, async () => {}).then(
      () => undefined,
      (error: Error) => error,
    ),
  );
/** Lets every pending callback run, so a job that would start has started. */
const quiet = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
};

test('a lane runs up to its concurrency at once, so one slow job holds only its own worker', async t => {
  const { startWorker, posted, workers } = fakeReportWorkers();
  const runner = new ReportRunner(WORKER, UNUSED, { startWorker });
  t.after(() => runner.close());

  const downloads = exportsFor(runner, [1, 2, 3, 4]);
  await postedJobs(posted, 3);
  await quiet();
  assert.deepEqual(
    posted.map(job => job.work.userId),
    [1, 2, 3],
    'three downloads run while the fourth waits',
  );
  assert.equal(workers.length, 3);
  // The first download stays slow; the second ends and the fourth takes its worker.
  posted[1]!.worker.finish(posted[1]!.id);
  await postedJobs(posted, 4);
  assert.equal(posted[3]!.worker, posted[1]!.worker);
  for (const job of posted.slice(2)) job.worker.finish(job.id);

  const reports = reportsFor(runner, [5, 6, 7]);
  await postedJobs(posted, 6);
  await quiet();
  assert.deepEqual(
    posted.slice(4).map(job => job.work.userId),
    [5, 6],
    'two reports run while the third waits',
  );
  assert.equal(workers.length, 5);
  for (const job of posted.slice(4)) job.worker.finish(job.id);
  await postedJobs(posted, 7);
  posted[6]!.worker.finish(posted[6]!.id);
  posted[0]!.worker.finish(posted[0]!.id);
  assert.deepEqual(await Promise.all([...downloads, ...reports]), Array(7).fill(undefined));
});

test('a freed worker goes to the account served longest ago, and shares still count running jobs', async t => {
  const { startWorker, posted } = fakeReportWorkers();
  const runner = new ReportRunner(WORKER, UNUSED, { startWorker, maxQueue: 8, maxPerUser: 3, concurrency: 2 });
  t.after(() => runner.close());
  const mine = reportsFor(runner, [1, 1, 1]);
  await postedJobs(posted, 2);
  const theirs = reportsFor(runner, [2]);
  const full = await runReport(runner, 1, 1, WEEKLY as never).catch((error: Error) => error);
  assert.match(String(full), /Report queue is full/, 'two running and one queued are the whole share');
  posted[0]!.worker.finish(posted[0]!.id);
  await postedJobs(posted, 3);
  assert.equal(posted[2]!.work.userId, 2, 'the other account goes before the third job of the first');
  for (const job of posted.slice(1)) job.worker.finish(job.id);
  await postedJobs(posted, 4);
  posted[3]!.worker.finish(posted[3]!.id);
  assert.deepEqual(await Promise.all([...mine, ...theirs]), Array(4).fill(undefined));
});

test('a lane starts one worker at a time, and a crash fails only the job on that worker', async t => {
  const { startWorker, posted, workers } = fakeReportWorkers();
  const runner = new ReportRunner(WORKER, UNUSED, { startWorker });
  t.after(() => runner.close());
  const [first, second] = reportsFor(runner, [1, 2]);
  assert.equal(workers.length, 1, 'the second worker waits until the first is up');
  await postedJobs(posted, 2);
  assert.equal(workers.length, 2);
  posted[0]!.worker.emit('exit', 1);
  assert.match(String(await first), /Report worker stopped/);
  posted[1]!.worker.finish(posted[1]!.id);
  assert.equal(await second, undefined);
});

test('a lane runs at least one job and at most its queue at once', () => {
  for (const concurrency of [0, 1.5, 17])
    assert.throws(() => new ReportRunner(INLINE, UNUSED, { maxQueue: 16, concurrency }), /Invalid report concurrency/);
  assert.throws(
    () => new ReportRunner(INLINE, UNUSED, { downloads: { maxQueue: 2, concurrency: 3 } }),
    /Invalid download concurrency/,
  );
  // A short queue lowers the default instead of refusing it.
  assert.doesNotThrow(() => new ReportRunner(INLINE, UNUSED, { maxQueue: 1, downloads: { maxQueue: 1 } }));
});

/** Waits until `ready()` holds, for at most `ms`, and says whether it did. */
async function until(ready: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!ready() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  return ready();
}

test('a report request the client abandons gives back its place, queued or running', async t => {
  const db = await openSQLiteDatabase();
  const user = await insertAccount(db, {
    email: 'abandon@example.test',
    fullname: 'Abandon',
    timezone: 'UTC',
    passwordHash: 'unused',
    role: 'user',
  });
  const { source, reading, release } = gatedSource();
  const runner = new ReportRunner(INLINE, source, { maxQueue: 4, maxPerUser: 2 });
  // What each report request handed the runner, so the test knows when a job was queued and when
  // the server saw its request close.
  const signals: AbortSignal[] = [];
  let submitted = 0;
  const reports: ReportExecutor = {
    reserve: (options, work) => {
      signals.push(options.signal!);
      return runner.reserve(options, slot =>
        work({
          run: (...args) => {
            submitted++;
            return slot.run(...args);
          },
        }),
      );
    },
    reserveDownload: (options, work) => runner.reserveDownload(options, work),
    close: () => runner.close(),
  };
  const app = createApp({ storage: storageFor(db), config: testConfig(), setup: { code: null }, reports });
  t.after(async () => {
    release();
    await app.locals.close();
  });
  const server = testServer(app);
  const authorization = `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}`;
  const post = (signal: AbortSignal) =>
    server
      .request('/api/app/report', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ start_date: '2026-01-01', end_date: '2026-01-07' }),
        signal,
      })
      .then(
        response => response.status,
        () => 'aborted',
      );
  /** Whether the account has `count` free places now. It holds them only while it checks. */
  const free = (count: number): Promise<boolean> => {
    const take = (left: number): Promise<boolean> =>
      left === 0 ? Promise.resolve(true) : runner.reserve({ userId: user.id }, () => take(left - 1));
    return take(count).catch(() => false);
  };

  const running = new AbortController();
  const answers = [post(running.signal)];
  await reading(1);
  const queued = new AbortController();
  answers.push(post(queued.signal));
  assert.ok(await until(() => submitted === 2), 'the second report was queued');
  assert.equal(await free(1), false, 'both places are taken');

  queued.abort();
  assert.ok(await until(() => signals[1]!.aborted), 'the server saw the queued request close');
  assert.equal(await free(1), true, 'the queued request gave back its place');
  assert.equal(await free(2), false, 'the running request still holds its place');

  running.abort();
  assert.ok(await until(() => signals[0]!.aborted), 'the server saw the running request close');
  assert.equal(await free(2), true, 'the running request gave back its place');
  assert.deepEqual(await Promise.all(answers), ['aborted', 'aborted']);
});
