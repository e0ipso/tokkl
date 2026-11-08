import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { TimerState } from '@tokkl/types';
import type { Storage } from '../../src/domain/ports.ts';
import type { User } from '../../src/domain/model.ts';
import { createStorage } from '../fixtures/storageShortcuts.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate, readTimerStream, serveInvariant } from './support/invariantHttp.ts';

const KEEP_ALIVE_MS = 150;
const withoutTime = ({ server_time: _time, ...state }: TimerState) => state;

/** Records the statements each snapshot read ran, and can hold the next read before it starts. */
function countedReads(storage: Storage, statements: () => number) {
  const reads: number[] = [];
  let held: { entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | undefined;
  return {
    storage: {
      ...storage,
      async readSnapshot(work) {
        const hold = held;
        held = undefined;
        if (hold) {
          hold.entered.resolve();
          await hold.release.promise;
        }
        const before = statements();
        try {
          return await storage.readSnapshot(work);
        } finally {
          reads.push(statements() - before);
        }
      },
    } satisfies Storage,
    reads,
    hold() {
      const hold = { entered: gate(), release: gate() };
      held = hold;
      return hold;
    },
    release() {
      held?.release.resolve();
      held = undefined;
    },
  };
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: the keep-alive tick delivers revisions the stream missed`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 2 };
    const c = await initializeDatabase(config),
      other = await openConnection<PhysicalDatabase>(config);
    let statements = 0;
    const counted = createStorage({
      ...other,
      db: other.db.withPlugin({
        transformQuery(args) {
          statements++;
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      }),
    });
    const local = createStorage(c),
      remote = countedReads(counted, () => statements);
    // Both instances use the default local bus, so B learns about A's commits only from its own tick.
    const apps = [
      createApp({
        storage: local,
        config: { ...testConfig(), storage: config },
        setup: { code: null },
        timerStreamOptions: { keepAliveMs: 600000 },
      }),
      createApp({
        storage: remote.storage,
        config: { ...testConfig(), storage: config },
        setup: { code: null },
        timerStreamOptions: { keepAliveMs: KEEP_ALIVE_MS },
      }),
    ];
    const servers = await Promise.all(apps.map(serveInvariant));
    const streams: Array<Awaited<ReturnType<typeof readTimerStream>>> = [];
    t.after(async () => {
      remote.release();
      await Promise.all(streams.map(s => s.close()));
      await Promise.all(servers.map(s => s.close()));
      await Promise.all([local.close(), counted.close()]);
      await fixture.cleanup();
    });
    // An API-token check reads one statement on top of the snapshot's own.
    const before = statements;
    await counted.readSnapshot(async () => undefined);
    const check = statements - before + 1;

    const u = await local.users.createAccount({
      email: 'u@example.test',
      fullName: 'u',
      passwordHash: 'unused',
      apiToken: randomBytes(16).toString('hex'),
      timezone: 'UTC',
      role: 'user',
      preferences: {},
    });
    const send = (app: number, user: User, method: string, path: string, body?: unknown) =>
      servers[app]!.request(method, path, body, user.apiToken);
    async function ok<T>(response: Response): Promise<T> {
      const body = (await response.json()) as T;
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    }
    const revision = async () => (await local.timers.getRevision(u.id))?.revision ?? 0;
    const running = `/api/v9/workspaces/${u.defaultWorkspaceId}/time_entries`;
    const onB = await readTimerStream(await send(1, u, 'GET', '/api/app/timer/events'));
    streams.push(onB);
    await onB.until(() => onB.states.length > 0);
    const keepAlives = () => onB.events.filter(e => e === 'keep-alive').length;
    const nextKeepAlives = async (n: number) => {
      const target = keepAlives() + n;
      await onB.until(() => keepAlives() >= target, { timeoutMs: 20 * KEEP_ALIVE_MS * n });
    };

    await t.test('a commit on another instance reaches the stream within one tick, rebuilt once', async () => {
      const reads = remote.reads.length;
      const started = await ok<TimerState>(await send(0, u, 'POST', '/api/app/pomodoro', {}));
      const mark = onB.events.length;
      await onB.until(() => onB.events.includes(started.revision), { describe: () => JSON.stringify(onB.events) });
      assert.deepEqual(
        onB.states.map(s => s.revision),
        [0, started.revision],
      );
      assert.deepEqual(withoutTime(onB.states[1]!), withoutTime(started));
      // A tick already past its check when the commit landed may write one keep-alive first.
      const between = onB.events.slice(mark, onB.events.indexOf(started.revision));
      assert.ok(between.length <= 2 && between.every(e => e === 'keep-alive'), JSON.stringify(between));
      await nextKeepAlives(1);
      assert.equal(
        remote.reads.slice(reads).filter(n => n !== check).length,
        1,
        'one rebuild, every other read is a check',
      );
      assert.equal(await revision(), started.revision, 'recovery never commits');
    });

    await t.test('a tick with nothing behind runs only the credential check', async () => {
      await nextKeepAlives(1);
      const reads = remote.reads.length,
        seen = onB.states.length;
      await nextKeepAlives(3);
      const ticks = remote.reads.slice(reads);
      assert.ok(ticks.length >= 2, JSON.stringify(ticks));
      assert.deepEqual(
        ticks,
        ticks.map(() => check),
      );
      assert.equal(onB.states.length, seen);
    });

    await t.test('a recovery tick overlapping a local publish delivers in order without deadlock', async t => {
      const seen = onB.states.length,
        base = await revision();
      const entry = (await local.entries.running(u.id))!;
      const published = t.mock.method(apps[1]!.locals.services.timerStreams, 'publish');
      // Hold the next tick inside the stream's queue, before its credential check reads.
      const held = remote.hold();
      await held.entered.promise;
      const onBWrite = send(1, u, 'PUT', `${running}/${entry.id}`, { description: 'on B' });
      // B's own commit is now waiting for the stream's queue, which the held tick occupies.
      const deadline = performance.now() + 5000;
      while (published.mock.callCount() === 0) {
        assert.ok(performance.now() < deadline, 'local publish reached the stream');
        await new Promise(r => setTimeout(r, 5));
      }
      await ok(await send(0, u, 'PUT', `${running}/${entry.id}`, { description: 'on A' }));
      assert.equal(await revision(), base + 2);
      // The tick now reads base + 2, ahead of both the stream and B's pending base + 1.
      held.release.resolve();
      await onB.until(() => onB.events.includes(base + 2), { describe: () => JSON.stringify(onB.events) });
      await ok(await onBWrite);
      assert.deepEqual(
        onB.states.slice(seen).map(s => s.revision),
        [base + 1, base + 2],
      );
      assert.equal(onB.states.at(-1)!.running_entry!.description, 'on A');
      assert.equal(await revision(), base + 2);
    });
  });
}
