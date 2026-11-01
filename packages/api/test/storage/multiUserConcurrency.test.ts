import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { TimerState } from '@tokkl/types';
import type { EntryDetails, User } from '../../src/storage/domain.ts';
import { createStorage } from '../../src/storage/index.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { readTimerStream, serveInvariant, transactionBarrier } from './support/invariantHttp.ts';

interface HttpEntry { id: number; user_id: number; workspace_id: number; project_id: number | null; task_id: number | null; stop: string | null; duration: number }
/** Clients carry their workspace as `wid`. Projects, tasks and tags carry it as `workspace_id`. */
interface HttpCatalogItem { id: number; name: string; wid?: number; workspace_id?: number }
interface HttpProject extends HttpCatalogItem { actual_seconds: number }
interface HttpTask extends HttpCatalogItem { project_id: number; tracked_seconds: number }
type CatalogKind = 'clients' | 'projects' | 'tasks' | 'tags';

/** One account and everything the test expects it to own after its own writes. */
interface Account {
  name: string; user: User; app: number;
  live: Set<number>; deleted: Set<number>; running: number | null; runningSince: number; revision: number;
  clients: Set<number>; projects: Set<number>; tasks: Set<number>; tags: Set<number>;
}
const catalogKinds: CatalogKind[] = ['clients', 'projects', 'tasks', 'tags'];
const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
const workspaceOf = (item: HttpCatalogItem) => item.workspace_id ?? item.wid;
const seconds = (entries: EntryDetails[]) => entries.reduce((sum, e) => sum + (Date.parse(e.stop!) - Date.parse(e.start)) / 1000, 0);
// `at(minute)` counts from a whole hour two days ago. Every minute the test passes is a multiple of
// five, so entries fall inside the default nine-day listing window and on the five-minute grid, and
// snapping keeps each duration the test asked for.
const origin = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 48 * 3_600_000;
const at = (minute: number) => new Date(origin + minute * 60_000).toISOString();

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: overlapping writes from different users leave each user exactly their own data`, { timeout: 240000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 };
    const c = await initializeDatabase(config), other = await openConnection<PhysicalDatabase>(config);
    const stores = [createStorage(c), createStorage(other)];
    // The barrier holds requests at `storage.transaction`. On SQLite that is before BEGIN IMMEDIATE,
    // so after release the writes take the write lock one at a time. The checks look only at
    // results, which must be the same whether the writes ran side by side or in a queue.
    const barrier = transactionBarrier();
    const apps = stores.map(storage => createApp({ storage: barrier.wrap(storage), config: { ...testConfig(), storage: config }, setup: { code: null } }));
    const servers = await Promise.all(apps.map(serveInvariant));
    t.after(async () => { barrier.release(); await Promise.all(servers.map(s => s.close())); await Promise.all(stores.map(s => s.close())); await fixture.cleanup(); });

    // Three regular accounts, each owning one workspace. A and C send through app 0 and its
    // connection, B through app 1 and the other connection.
    const accounts: Account[] = [];
    for (const [i, name] of ['a', 'b', 'c'].entries()) {
      const user = await stores[0]!.users.createAccount({ email: `${name}@example.test`, fullName: name, passwordHash: 'unused',
        apiToken: randomBytes(16).toString('hex'), timezone: 'UTC', role: 'user', preferences: {} });
      assert.deepEqual((await stores[0]!.workspaces.listForUser(user.id)).map(w => w.id), [user.defaultWorkspaceId], `${name}: owns one workspace`);
      accounts.push({ name, user, app: i % 2, live: new Set(), deleted: new Set(), running: null, runningSince: 0, revision: 0,
        clients: new Set(), projects: new Set(), tasks: new Set(), tags: new Set() });
    }
    const ws = (u: Account) => `/api/v9/workspaces/${u.user.defaultWorkspaceId}`;
    const send = (u: Account, method: string, path: string, body?: unknown) => servers[u.app]!.request(method, path, body, u.user.apiToken);
    async function ok<T>(u: Account, response: Response): Promise<T> {
      const text = await response.text();
      assert.equal(response.status, 200, `${u.name}: ${response.status} ${text}`);
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const read = async <T>(u: Account, path: string) => ok<T>(u, await send(u, 'GET', path));
    /** Each account sends one write. The barrier holds them until all have reached `storage.transaction`,
     * then releases them together. Every write must return 200. */
    async function together<T>(write: (u: Account, i: number) => Promise<Response>): Promise<T[]> {
      const responses = await barrier.overlap(...accounts.map((u, i) => () => write(u, i)));
      return Promise.all(responses.map((response, i) => ok<T>(accounts[i]!, response)));
    }
    async function runningByUser() {
      const rows = await c.db.selectFrom('time_entries').select(['id', 'user_id']).where('stop', 'is', null).where('deleted_at', 'is', null).execute();
      return rows.map(r => [Number(r.user_id), Number(r.id)]).sort((x, y) => x[0]! - y[0]!);
    }
    const expectedRunning = () => accounts.filter(u => u.running !== null).map(u => [u.user.id, u.running!]).sort((x, y) => x[0]! - y[0]!);
    /** Storage and HTTP show each account exactly the rows it wrote and none of the other accounts' rows. */
    async function verify() {
      const owned = (pick: (u: Account) => number) => accounts.reduce((sum, u) => sum + pick(u), 0);
      assert.equal((await c.db.selectFrom('time_entries').select('id').execute()).length, owned(u => u.live.size + u.deleted.size), 'every entry belongs to one of the accounts');
      for (const kind of catalogKinds) assert.equal((await c.db.selectFrom(kind).select('id').execute()).length, owned(u => u[kind].size), `every ${kind} row belongs to one of the accounts`);
      assert.deepEqual(await runningByUser(), expectedRunning(), 'running entries by user');
      for (const u of accounts) {
        const uid = u.user.id, wid = u.user.defaultWorkspaceId;
        const rows = await c.db.selectFrom('time_entries').select(['id', 'user_id', 'workspace_id', 'deleted_at'])
          .where(eb => eb.or([eb('user_id', '=', uid), eb('workspace_id', '=', wid)])).execute();
        assert.ok(rows.every(r => Number(r.user_id) === uid && Number(r.workspace_id) === wid), `${u.name}: stored entries stay with their owner and workspace`);
        assert.deepEqual(sorted(rows.map(r => Number(r.id))), sorted([...u.live, ...u.deleted]), `${u.name}: stored entries`);
        assert.deepEqual(sorted(rows.filter(r => r.deleted_at === null).map(r => Number(r.id))), sorted(u.live), `${u.name}: stored live entries`);
        for (const kind of catalogKinds) {
          const ids = (await c.db.selectFrom(kind).select('id').where('workspace_id', '=', wid).execute()).map(r => Number(r.id));
          assert.deepEqual(sorted(ids), sorted(u[kind]), `${u.name}: stored ${kind}`);
        }
        assert.equal((await stores[u.app]!.timers.getRevision(uid))?.revision ?? 0, u.revision, `${u.name}: stored timer revision`);

        const entries = await read<HttpEntry[]>(u, '/api/v9/me/time_entries');
        assert.ok(entries.every(e => e.user_id === uid && e.workspace_id === wid), `${u.name}: listed entries are their own`);
        assert.deepEqual(sorted(entries.map(e => e.id)), sorted(u.live), `${u.name}: listed entries`);
        for (const kind of catalogKinds) {
          const items = await read<HttpCatalogItem[]>(u, `/api/v9/me/${kind}`);
          assert.ok(items.every(item => workspaceOf(item) === wid), `${u.name}: listed ${kind} are their own`);
          assert.deepEqual(sorted(items.map(item => item.id)), sorted(u[kind]), `${u.name}: listed ${kind}`);
        }
        // GET /api/app/timer settles the timer in a write transaction. It must find nothing to
        // change, because the stored revision is already current.
        const timer = await read<TimerState>(u, '/api/app/timer');
        assert.equal(timer.revision, u.revision, `${u.name}: timer revision`);
        assert.equal(timer.running_entry?.id ?? null, u.running, `${u.name}: timer running entry`);
        if (timer.running_entry) assert.equal(timer.running_entry.workspace_id, wid, `${u.name}: timer workspace`);
      }
    }

    await t.test('each user starts, stops and then adds a finished entry while the others do the same', async () => {
      const started = await together<HttpEntry>(u => send(u, 'POST', `${ws(u)}/time_entries`, { start: at(0), description: `${u.name} timer` }));
      for (const [i, u] of accounts.entries()) {
        assert.equal(started[i]!.user_id, u.user.id); assert.equal(started[i]!.stop, null);
        u.live.add(started[i]!.id); u.running = started[i]!.id; u.revision++;
      }
      assert.deepEqual(await runningByUser(), expectedRunning());
      const stopped = await together<HttpEntry>(u => send(u, 'PATCH', `${ws(u)}/time_entries/${u.running}/stop`, { stop: at(60) }));
      for (const [i, u] of accounts.entries()) {
        assert.equal(stopped[i]!.id, u.running); assert.equal(stopped[i]!.duration, 3600);
        u.running = null; u.revision++;
      }
      const finished = await together<HttpEntry>(u => send(u, 'POST', `${ws(u)}/time_entries`, { start: at(90), stop: at(120), description: `${u.name} finished` }));
      for (const [i, u] of accounts.entries()) {
        assert.equal(finished[i]!.user_id, u.user.id); assert.equal(finished[i]!.duration, 1800);
        u.live.add(finished[i]!.id);
      }
      await verify();
    });

    await t.test('a timer start stops only its own user\'s timer and bumps only its own user\'s revision', async () => {
      // In each round a user either starts a timer or adds a finished entry. Every user starts at
      // least once while another user's timer is running. Users make different numbers of timer
      // changes, so a revision bumped for the wrong user cannot add up by chance.
      const rounds = [['start', 'start', 'finish'], ['start', 'start', 'start'], ['start', 'finish', 'finish']] as const;
      for (const [r, round] of rounds.entries()) {
        // Users start at different minutes, and the gap between them grows each round, so a timer
        // stopped at another user's start would end up with the wrong duration.
        const minute = (i: number) => 180 + r * 60 + i * (r + 1) * 5;
        const previous = accounts.map(u => ({ id: u.running, since: u.runningSince }));
        const created = await together<HttpEntry>((u, i) => send(u, 'POST', `${ws(u)}/time_entries`, round[i] === 'start'
          ? { start: at(minute(i)), description: `${u.name} timer ${r}` }
          : { start: at(minute(i)), stop: at(minute(i) + 15), description: `${u.name} finished ${r}` }));
        for (const [i, u] of accounts.entries()) {
          const entry = created[i]!;
          assert.equal(entry.user_id, u.user.id); u.live.add(entry.id);
          if (round[i] === 'finish') { assert.equal(entry.duration, 900); continue; }
          assert.equal(entry.stop, null);
          u.running = entry.id; u.runningSince = minute(i); u.revision++;
          // The replaced timer stopped where its owner's new one started.
          const replaced = previous[i]!;
          if (replaced.id !== null) assert.equal((await read<HttpEntry>(u, `/api/v9/me/time_entries/${replaced.id}`)).duration, (minute(i) - replaced.since) * 60, `${u.name}: replaced timer stop`);
        }
        assert.deepEqual(await runningByUser(), expectedRunning(), `running entries after round ${r}`);
      }
      assert.deepEqual(accounts.map(u => u.revision), [5, 4, 3]);
      await verify();
    });

    await t.test('same-named clients, projects and tags created at once each land in their owner\'s workspace', async () => {
      const clients = await together<HttpCatalogItem>(u => send(u, 'POST', `${ws(u)}/clients`, { name: 'Shared' }));
      const projects = await together<HttpCatalogItem & { client_id: number }>((u, i) => send(u, 'POST', `${ws(u)}/projects`, { name: 'Shared', client_id: clients[i]!.id }));
      const tags = await together<HttpCatalogItem>(u => send(u, 'POST', `${ws(u)}/tags`, { name: 'Shared' }));
      for (const [i, u] of accounts.entries()) {
        for (const [kind, item] of [['clients', clients[i]!], ['projects', projects[i]!], ['tags', tags[i]!]] as const) {
          assert.equal(item.name, 'Shared'); assert.equal(workspaceOf(item), u.user.defaultWorkspaceId, `${u.name}: new ${kind} workspace`);
          u[kind].add(item.id);
        }
        assert.equal(projects[i]!.client_id, clients[i]!.id);
      }
      await verify();
    });

    await t.test('overlapping entry and project updates and deletes keep each owner\'s project and task totals', async () => {
      // Each user gets the same layout. Durations scale with k, so totals differ between users.
      const own = accounts.map((u, i) => ({ k: i + 1, project: [...u.projects][0]!, task: 0, extra: 0, timerProject: 0, entries: [] as number[] }));
      const tasks = await together<HttpTask>((u, i) => send(u, 'POST', `${ws(u)}/projects/${own[i]!.project}/tasks`, { name: 'Shared' }));
      const extras = await together<HttpProject>(u => send(u, 'POST', `${ws(u)}/projects`, { name: 'Extra' }));
      const timerProjects = await together<HttpProject>(u => send(u, 'POST', `${ws(u)}/projects`, { name: 'Timer' }));
      for (const [i, u] of accounts.entries()) {
        own[i]!.task = tasks[i]!.id; own[i]!.extra = extras[i]!.id; own[i]!.timerProject = timerProjects[i]!.id;
        u.tasks.add(tasks[i]!.id); u.projects.add(extras[i]!.id); u.projects.add(timerProjects[i]!.id);
      }
      // Moving the running timer onto a project changes the timer, so each owner's revision goes up once.
      const moved = await together<HttpEntry>((u, i) => send(u, 'PUT', `${ws(u)}/time_entries/${u.running}`, { project_id: own[i]!.timerProject }));
      for (const [i, u] of accounts.entries()) { assert.equal(moved[i]!.project_id, own[i]!.timerProject); u.revision++; }

      // Finished entries: 10k and 20k minutes on the project and task, 30k on the project alone, 40k on the extra project.
      const layout = [{ minutes: 10, task: true }, { minutes: 20, task: true }, { minutes: 30, task: false }, { minutes: 40, extra: true }];
      for (const [j, spec] of layout.entries()) {
        const start = 600 + j * 150;
        const created = await together<HttpEntry>((u, i) => send(u, 'POST', `${ws(u)}/time_entries`, { start: at(start), stop: at(start + spec.minutes * own[i]!.k),
          project_id: spec.extra ? own[i]!.extra : own[i]!.project, ...(spec.task ? { task_id: own[i]!.task } : {}) }));
        for (const [i, u] of accounts.entries()) {
          assert.equal(created[i]!.duration, spec.minutes * own[i]!.k * 60);
          own[i]!.entries.push(created[i]!.id); u.live.add(created[i]!.id);
        }
      }
      /** Compares HTTP totals with known values and with the owner's entries in storage. */
      async function totals(project: number, task: number) {
        for (const [i, u] of accounts.entries()) {
          const mine = own[i]!, base = `${ws(u)}/projects/${mine.project}`;
          const summary = await read<HttpProject>(u, base), taskSummary = await read<HttpTask>(u, `${base}/tasks/${mine.task}`);
          assert.equal(summary.actual_seconds, project * mine.k * 60, `${u.name}: project actual_seconds`);
          // Toggl documents tracked_seconds as milliseconds.
          assert.equal(taskSummary.tracked_seconds, task * mine.k * 60_000, `${u.name}: task tracked_seconds`);
          const finished = (await stores[u.app]!.entries.list(u.user.id, { from: at(0) })).filter(e => e.stop !== null);
          assert.equal(summary.actual_seconds, seconds(finished.filter(e => e.projectId === mine.project)), `${u.name}: project total matches the owner's entries`);
          assert.equal(taskSummary.tracked_seconds, seconds(finished.filter(e => e.taskId === mine.task)) * 1000, `${u.name}: task total matches the owner's entries`);
          const foreign = await c.db.selectFrom('time_entries').select('id').where('user_id', '!=', u.user.id)
            .where(eb => eb.or([eb('project_id', 'in', [...u.projects]), eb('task_id', 'in', [...u.tasks])])).execute();
          assert.deepEqual(foreign, [], `${u.name}: no other user's entry counts toward this user's projects or tasks`);
        }
      }
      await totals(60, 30);

      // Five writes per user. Rotating them means that in every round each user runs a different write.
      const writes: Array<(u: Account, mine: typeof own[number]) => Promise<Response>> = [
        (u, mine) => send(u, 'PUT', `${ws(u)}/time_entries/${mine.entries[0]}`, { duration: 25 * mine.k * 60 }),
        (u, mine) => send(u, 'DELETE', `${ws(u)}/time_entries/${mine.entries[1]}`),
        (u, mine) => send(u, 'PUT', `${ws(u)}/time_entries/${mine.entries[2]}`, { task_id: mine.task }),
        (u, mine) => send(u, 'PUT', `${ws(u)}/projects/${mine.timerProject}`, { name: 'Timer renamed' }),
        // Odd k deletes the extra project's entries with it, even k keeps them without a project.
        (u, mine) => send(u, 'DELETE', `${ws(u)}/projects/${mine.extra}${mine.k % 2 ? '?teDeletionMode=delete' : ''}`),
      ];
      for (let r = 0; r < writes.length; r++) await together((u, i) => writes[(i + r) % writes.length]!(u, own[i]!));
      for (const [i, u] of accounts.entries()) {
        const mine = own[i]!;
        u.live.delete(mine.entries[1]!); u.deleted.add(mine.entries[1]!);
        if (mine.k % 2) { u.live.delete(mine.entries[3]!); u.deleted.add(mine.entries[3]!); }
        u.projects.delete(mine.extra);
        // Renaming the running timer's project changed the owner's timer once more.
        u.revision++;
      }
      // 25k (lengthened) plus 30k (moved onto the task) minutes; the deleted 20k entry no longer counts.
      await totals(55, 55);
      for (const [i, u] of accounts.entries()) {
        const mine = own[i]!;
        const gone = await send(u, 'GET', `${ws(u)}/projects/${mine.extra}`);
        assert.equal(gone.status, 404, `${u.name}: deleted extra project`); await gone.body?.cancel();
        const kept = await stores[u.app]!.entries.get(u.user.id, mine.entries[3]!, true);
        assert.equal(kept?.projectId, null, `${u.name}: extra project's entry lost its project`);
        assert.equal(kept?.deletedAt === null, mine.k % 2 === 0, `${u.name}: extra project's entry deleted only with teDeletionMode=delete`);
        const timer = await read<TimerState>(u, '/api/app/timer');
        assert.equal(timer.running_entry?.project_id, mine.timerProject); assert.equal(timer.running_entry?.project_name, 'Timer renamed');
      }
      assert.deepEqual(accounts.map(u => u.revision), [7, 6, 5]);
      await verify();
    });

    await t.test('each user\'s timer stream carries only that user\'s states while both users change their timers at once', async t => {
      // Each app delivers only the commits made through it to its own streams, and nothing passes
      // timer states between apps. So A and B both stream and write through one app, as they would
      // against one server. On the server engines its pool holds two connections, so the writes the
      // barrier releases run side by side; on SQLite they queue on the write lock.
      const streamConfig = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 2 };
      const storage = createStorage(await openConnection<PhysicalDatabase>(streamConfig));
      const server = await serveInvariant(createApp({ storage: barrier.wrap(storage), config: { ...testConfig(), storage: streamConfig }, setup: { code: null } }));
      const streams = new Map<Account, Awaited<ReturnType<typeof readTimerStream>>>();
      t.after(async () => {
        barrier.release();
        await Promise.all([...streams.values()].map(s => s.close()));
        await server.close(); await storage.close();
      });
      const [a, b] = accounts as [Account, Account];
      const send = (u: Account, method: string, path: string, body?: unknown) => server.request(method, path, body, u.user.apiToken);
      assert.notEqual(b.running, null, 'b starts with a running timer for its first change to stop');

      const project = new Map<Account, number>();
      for (const u of [a, b]) {
        const created = await ok<HttpProject>(u, await send(u, 'POST', `${ws(u)}/projects`, { name: `${u.name}-stream` }));
        project.set(u, created.id); u.projects.add(created.id);
      }
      /** What an account owns in storage: entry ids and descriptions, and each project's names. */
      interface Owned { entries: Set<number>; descriptions: Set<string>; projects: Map<number, Set<string>> }
      async function collect(u: Account, owned: Owned = { entries: new Set(), descriptions: new Set(), projects: new Map() }) {
        for (const e of await c.db.selectFrom('time_entries').select(['id', 'description']).where('user_id', '=', u.user.id).execute()) {
          owned.entries.add(Number(e.id)); owned.descriptions.add(e.description);
        }
        for (const p of await c.db.selectFrom('projects').select(['id', 'name']).where('workspace_id', '=', u.user.defaultWorkspaceId).execute()) {
          const names = owned.projects.get(Number(p.id)) ?? new Set<string>();
          names.add(p.name); owned.projects.set(Number(p.id), names);
        }
        return owned;
      }
      // Collected before and after the writes, so each project keeps the name it had before the rename.
      const owned = new Map([[a, await collect(a)], [b, await collect(b)]]);

      const received = () => [a, b].map(u => `${u.name} received: ${JSON.stringify(streams.get(u)?.states ?? [])}`).join('\n');
      const opened = new Map<Account, number>();
      for (const u of [a, b]) {
        const stream = await readTimerStream(await send(u, 'GET', '/api/app/timer/events'));
        streams.set(u, stream);
        await stream.until(() => stream.states.length > 0, { timeoutMs: 10000, describe: received });
        assert.equal(stream.states[0]!.revision, u.revision, `${u.name}: the stream opens with the current timer`);
        opened.set(u, u.revision);
      }

      // Every change below changes its user's timer once. Pomodoro entries start at the server's
      // clock, later than every `at()` time, so neither user starts or stops an entry after their
      // Pomodoro start. `onProject` holds the running entry each user put on their stream project.
      const onProject = new Map<Account, number>();
      const change = {
        start: (minute: number) => async (u: Account) => {
          const entry = await ok<HttpEntry>(u, await send(u, 'POST', `${ws(u)}/time_entries`, { start: at(minute), description: `${u.name}-1`, project_id: project.get(u) }));
          assert.equal(entry.user_id, u.user.id); assert.equal(entry.stop, null); assert.equal(entry.project_id, project.get(u));
          u.live.add(entry.id); u.running = entry.id; onProject.set(u, entry.id);
        },
        stop: (minute: number) => async (u: Account) => {
          const entry = await ok<HttpEntry>(u, await send(u, 'PATCH', `${ws(u)}/time_entries/${u.running}/stop`, { stop: at(minute) }));
          assert.equal(entry.id, u.running); assert.notEqual(entry.stop, null);
          u.running = null;
        },
        pomodoro: async (u: Account) => {
          const state = await ok<TimerState>(u, await send(u, 'POST', '/api/app/pomodoro', { description: `${u.name}-pomodoro`, project_id: project.get(u) }));
          assert.ok(state.pomodoro, `${u.name}: Pomodoro session`); assert.equal(state.running_entry?.project_id, project.get(u));
          u.live.add(state.running_entry!.id); u.running = state.running_entry!.id; onProject.set(u, u.running);
        },
        rename: async (u: Account) => {
          assert.equal(u.running, onProject.get(u), `${u.name}: an entry runs on the project being renamed`);
          const renamed = await ok<HttpProject>(u, await send(u, 'PUT', `${ws(u)}/projects/${project.get(u)}`, { name: `${u.name}-stream renamed` }));
          assert.equal(renamed.name, `${u.name}-stream renamed`);
        },
      };
      // The users make a different change in every round.
      const rounds = [
        [change.start(1440), change.stop(1440)],
        [change.rename, change.start(1500)],
        [change.stop(1470), change.pomodoro],
        [change.pomodoro, change.rename],
      ] as const;
      for (const [forA, forB] of rounds) {
        await barrier.overlap(() => forA(a), () => forB(b));
        a.revision++; b.revision++;
      }

      const current = new Map<Account, TimerState>();
      for (const u of [a, b]) {
        const timer = await ok<TimerState>(u, await send(u, 'GET', '/api/app/timer'));
        assert.equal(timer.revision, u.revision, `${u.name}: timer revision`);
        assert.equal(timer.running_entry?.id, u.running, `${u.name}: running entry`);
        current.set(u, timer);
        const stream = streams.get(u)!;
        await stream.until(() => stream.states.some(s => s.revision >= timer.revision), { timeoutMs: 10000, describe: received });
      }
      for (const [u, other] of [[a, b], [b, a]] as const) {
        const mine = await collect(u, owned.get(u)), theirs = await collect(other, owned.get(other));
        const theirDescriptions = new Set([...theirs.descriptions].filter(text => !mine.descriptions.has(text)));
        const states = streams.get(u)!.states;
        for (const [i, state] of states.entries()) {
          const where = `${u.name}'s stream, event ${i} at revision ${state.revision}`;
          assert.ok(i === 0 || state.revision > states[i - 1]!.revision, `${where}: revisions only increase`);
          const { running_entry: entry, pause, pomodoro, discarded_pomodoro: discarded } = state;
          if (entry) {
            assert.equal((entry as typeof entry & { user_id: number }).user_id, u.user.id, `${where}: running entry owner`);
            assert.equal(entry.workspace_id, u.user.defaultWorkspaceId, `${where}: running entry workspace`);
            if (entry.project_id !== null) assert.ok(mine.projects.get(entry.project_id)?.has(entry.project_name!), `${where}: project name ${entry.project_name}`);
          }
          if (pause) assert.equal(pause.workspace_id, u.user.defaultWorkspaceId, `${where}: pause workspace`);
          for (const id of [entry?.id, pomodoro?.entry_id, pause?.clone_entry_id, discarded?.entry_id]) {
            if (id == null) continue;
            assert.ok(!theirs.entries.has(id), `${where}: entry ${id} belongs to ${other.name}`);
            assert.ok(mine.entries.has(id), `${where}: entry ${id} is not this user's`);
          }
          for (const id of [entry?.project_id, pause?.project_id]) {
            if (id == null) continue;
            assert.ok(!theirs.projects.has(id), `${where}: project ${id} belongs to ${other.name}`);
            assert.ok(mine.projects.has(id), `${where}: project ${id} is not this user's`);
          }
          for (const text of [entry?.description, pause?.description]) {
            if (text == null) continue;
            assert.ok(!theirDescriptions.has(text), `${where}: description ${JSON.stringify(text)} belongs to ${other.name}`);
            assert.ok(mine.descriptions.has(text), `${where}: description ${JSON.stringify(text)} is not this user's`);
          }
        }
        // Each user's changes ran one after another, and a write answers only after its state was
        // published, so the stream holds every revision of the user's timer since it opened.
        assert.deepEqual(states.map(s => s.revision), Array.from({ length: u.revision - opened.get(u)! + 1 }, (_, i) => opened.get(u)! + i), `${u.name}: stream revisions`);
        const { server_time: _streamed, ...last } = states.at(-1)!, { server_time: _read, ...expected } = current.get(u)!;
        assert.deepEqual(last, expected, `${u.name}: the stream's last state is the user's current timer`);
      }
      assert.deepEqual(accounts.map(u => u.revision), [11, 10, 5]);
      await verify();
    });
  });
}
