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
import { ReportRunner } from '../src/services/reportRunner.ts';
import type { JobSource } from '../src/services/reportExecution.ts';
import type { Storage } from '../src/storage/contracts.ts';

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
    runner.run(1, 1, WEEKLY as never).catch(() => {}),
    runner.export(1, EXPORT, async () => {}).catch(() => {}),
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
  const exporting = runner.export(1, EXPORT, async () => {}).catch(error => error);
  t.after(async () => {
    release();
    await exporting;
    await runner.close();
  });
  while (reads === 0) await new Promise(resolve => setImmediate(resolve));
  const report = runner.run(2, 1, WEEKLY as never).then(
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
    runner.export(1, EXPORT, async () => {}),
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
      await slot.run(1, 1, WEEKLY as never).catch(() => {});
      return slot.run(1, 1, WEEKLY as never);
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
  const mine = [1, 2, 3].map(() => runner.run(1, 1, WEEKLY as never).catch(error => error));
  await reading(1);
  await assert.rejects(
    runner.run(1, 1, WEEKLY as never),
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
  const theirs = runner.run(2, 2, WEEKLY as never).catch(error => error);
  for (let i = 0; i < 4; i++) {
    await reading(i + 1);
    release();
  }
  for (const result of await Promise.all([...mine, theirs])) assert.ok(result instanceof ApplicationError);
  // Once its jobs finish, the account has its whole share again.
  const again = [1, 2, 3].map(() => runner.run(1, 1, WEEKLY as never).catch(error => error));
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
    ...[1, 1, 1, 1].map(user => runner.run(user, user, WEEKLY as never).catch(() => {})),
    ...[2, 2].map(user => runner.run(user, user, WEEKLY as never).catch(() => {})),
    runner.run(3, 3, WEEKLY as never).catch(() => {}),
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
