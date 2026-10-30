/**
 * Runs the KDE companion's real-server test (realservertest.cpp) against two Tokkl instances
 * built with the API's multi-user test fixtures, then checks that each instance's data changed
 * only where the companion was allowed to change it.
 *
 *   TOKKL_KDE_REALSERVER_COMMAND='["<build>/tests/realservertest"]' \
 *     node --test desktop/kde/tests/realserver.test.ts
 *
 * TOKKL_KDE_REALSERVER_COMMAND is a JSON array: the command that runs the test binary, for
 * example through `docker run --network host` (desktop/kde/ci/realserver.sh). It gets the fixture
 * in the TOKKL_REALSERVER_FIXTURE environment variable. Each instance sits behind a proxy on
 * 127.0.0.1. The proxy passes an event stream through as it arrives and never holds it; it holds
 * any other reply back when told to, and it counts every request it receives. A control server
 * lets the binary hold, release and cut off replies, stall the event streams so a client sees
 * them go silent, count the requests the proxy received, disable an account, remove a workspace
 * membership and make a request as one of the fixture accounts, as another device would.
 * TOKKL_KDE_TEST_PORT sets the first of the three ports; without it the system picks free ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { addUser, PASSWORD, setup, type TestContext } from '../../../packages/api/test/helpers.ts';
import { addWorkspaceMember } from '../../../packages/api/test/fixtures/domain.ts';

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

interface Entry {
  id: number;
  wid: number;
  description: string;
  start: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}
/** What a running entry carries besides its description and start. */
interface EntryFields { project_id?: number; task_id?: number; tags?: string[]; billable?: boolean }
interface FixtureUser {
  instance: string;
  id: number;
  wid: number;
  email: string;
  token: string;
  password: string;
  projects: { id: number; name: string }[];
  running: Entry | null;
}

/** A reply the proxy keeps back: send it on release, or cut it off before its end. */
interface HeldReply { send: () => void; drop: () => void }

/** An instance: its admin's context (and so its database and app) and the proxy in front of it. */
interface Instance {
  name: string;
  admin: TestContext;
  holds: { method: string; path: string }[];
  held: HeldReply[];
  /** While true, an event stream's bytes and its end wait here instead of reaching the client. */
  streamsStalled: boolean;
  stalled: (() => void)[];
  /** Every request the proxy received, in order: what reached the server, not what a client logged. */
  seen: { method: string; path: string }[];
  url?: string;
}

async function ok<T>(ctx: TestContext, method: string, path: string, body?: unknown): Promise<T> {
  const response = await ctx.json<T>(method, path, body);
  assert.ok(response.status >= 200 && response.status < 300, `${method} ${path} as ${ctx.user.email}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function project(ctx: TestContext, wid: number, name: string) {
  return ok<{ id: number; name: string }>(ctx, 'POST', `/api/v9/workspaces/${wid}/projects`, { name, active: true });
}

async function running(ctx: TestContext, wid: number, description: string, start: Date, fields: EntryFields = {}): Promise<Entry> {
  const entry = await ok<Omit<Entry, 'wid'> & { workspace_id: number }>(
    ctx, 'POST', `/api/v9/workspaces/${wid}/time_entries`,
    { workspace_id: wid, description, start: start.toISOString(), duration: -1, created_with: 'fixture', ...fields },
  );
  return {
    id: entry.id, wid: entry.workspace_id, description: entry.description, start: entry.start,
    project_id: entry.project_id, task_id: entry.task_id, tags: [...entry.tags].sort(), billable: entry.billable,
  };
}

function describeUser(instance: string, ctx: TestContext, wid: number, projects: FixtureUser['projects'], entry: Entry | null): FixtureUser {
  return {
    instance, id: ctx.user.id, wid, email: ctx.user.email, token: ctx.user.apiToken, password: PASSWORD,
    projects: [...projects].sort((a, b) => a.id - b.id), running: entry,
  };
}

/**
 * The same accounts, projects and running entries in the same order on each instance, so their ids
 * collide; names and start times differ. Instance a also gets the accounts that lose access.
 */
async function seed(name: string, extra: boolean) {
  const label = name.toUpperCase();
  const hour = 3_600_000;
  const now = Date.now();
  const users: Record<string, FixtureUser> = {};
  const contexts: Record<string, TestContext> = {};

  const admin = await setup();
  await ok(admin, 'PUT', '/api/app/admin/settings', { time_resolution_minutes: RESOLUTION_MINUTES });
  const adminProject = await project(admin, admin.wid, `${label} admin project`);
  const adminEntry = await running(admin, admin.wid, `${label} admin running`, new Date(now - 3 * hour), { project_id: adminProject.id });
  users[`${name}.admin`] = describeUser(name, admin, admin.wid, [adminProject], adminEntry);
  contexts[`${name}.admin`] = admin;

  const u = await addUser(admin, { email: `u@${name}.example.com`, role: 'user' });
  const uProjects = [await project(u, u.wid, `${label} u first`), await project(u, u.wid, `${label} u second`)];
  users[`${name}.u`] = describeUser(name, u, u.wid, uProjects, null);
  contexts[`${name}.u`] = u;

  const s = await addUser(admin, { email: `s@${name}.example.com`, role: 'user' });
  const sProject = await project(s, s.wid, `${label} s project`);
  const sEntry = await running(s, s.wid, `${label} s running`, new Date(now - (extra ? 2 : 1) * hour), { project_id: sProject.id });
  users[`${name}.s`] = describeUser(name, s, s.wid, [sProject], sEntry);
  contexts[`${name}.s`] = s;

  if (extra) {
    // Works in the admin's workspace as a member, so it can lose it.
    const m = await addUser(admin, { email: `m@${name}.example.com`, role: 'user' });
    await addWorkspaceMember(m.db, admin.wid, m.user.id, 'member');
    await ok(m, 'PUT', '/api/v9/me', { default_workspace_id: admin.wid });
    const mEntry = await running(m, admin.wid, `${label} m running`, new Date(now - hour));
    users[`${name}.m`] = describeUser(name, m, admin.wid, [adminProject], mEntry);
    contexts[`${name}.m`] = m;

    for (const key of ['dt', 'dp']) {
      const ctx = await addUser(admin, { email: `${key}@${name}.example.com`, role: 'user' });
      const entry = await running(ctx, ctx.wid, `${label} ${key} running`, new Date(now - hour));
      users[`${name}.${key}`] = describeUser(name, ctx, ctx.wid, [], entry);
      contexts[`${name}.${key}`] = ctx;
    }

    // Pauses and resumes an entry with a task, tags and the billable flag, then loses the task
    // and the project while paused.
    const p = await addUser(admin, { email: `p@${name}.example.com`, role: 'user' });
    const pProject = await project(p, p.wid, `${label} p project`);
    const pTask = await ok<{ id: number }>(p, 'POST', `/api/v9/workspaces/${p.wid}/projects/${pProject.id}/tasks`, { name: `${label} p task` });
    const pEntry = await running(p, p.wid, `${label} p running`, new Date(now - hour),
      { project_id: pProject.id, task_id: pTask.id, tags: ['kde', 'focus'], billable: true });
    users[`${name}.p`] = describeUser(name, p, p.wid, [pProject], pEntry);
    contexts[`${name}.p`] = p;

    // Pauses an entry with a project and no task, then loses the project while paused. The server
    // checks a task before the project, so only a chain without a task is refused for the project.
    const q = await addUser(admin, { email: `q@${name}.example.com`, role: 'user' });
    const qProject = await project(q, q.wid, `${label} q project`);
    const qEntry = await running(q, q.wid, `${label} q running`, new Date(now - hour), { project_id: qProject.id });
    users[`${name}.q`] = describeUser(name, q, q.wid, [qProject], qEntry);
    contexts[`${name}.q`] = q;

    // Runs a Pomodoro session from the companion: starts it, confirms Next phase twice and ends it.
    const sn = await addUser(admin, { email: `sn@${name}.example.com`, role: 'user' });
    const snProject = await project(sn, sn.wid, `${label} sn project`);
    users[`${name}.sn`] = describeUser(name, sn, sn.wid, [snProject], null);
    contexts[`${name}.sn`] = sn;

    // Pauses, resumes, pauses again and discards the chain.
    const pc = await addUser(admin, { email: `pc@${name}.example.com`, role: 'user' });
    const pcProject = await project(pc, pc.wid, `${label} pc project`);
    const pcEntry = await running(pc, pc.wid, `${label} pc running`, new Date(now - hour), { project_id: pcProject.id, billable: true });
    users[`${name}.pc`] = describeUser(name, pc, pc.wid, [pcProject], pcEntry);
    contexts[`${name}.pc`] = pc;

    // Has its session started, advanced and ended by another device, through the API.
    const pu = await addUser(admin, { email: `pu@${name}.example.com`, role: 'user' });
    users[`${name}.pu`] = describeUser(name, pu, pu.wid, [], null);
    contexts[`${name}.pu`] = pu;

    // Pauses, and the reply to the pause is dropped.
    const hd = await addUser(admin, { email: `hd@${name}.example.com`, role: 'user' });
    const hdProject = await project(hd, hd.wid, `${label} hd project`);
    const hdEntry = await running(hd, hd.wid, `${label} hd running`, new Date(now - hour), { project_id: hdProject.id });
    users[`${name}.hd`] = describeUser(name, hd, hd.wid, [hdProject], hdEntry);
    contexts[`${name}.hd`] = hd;
  }
  return { admin, users, contexts };
}

type Row = Record<string, unknown>;
function rows(ctx: TestContext, table: string): Row[] {
  return ctx.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }));
}
function snapshot(ctx: TestContext) {
  return {
    users: rows(ctx, 'users'),
    workspaces: rows(ctx, 'workspaces'),
    memberships: rows(ctx, 'workspace_users'),
    projects: rows(ctx, 'projects'),
    tasks: rows(ctx, 'tasks'),
    entries: rows(ctx, 'time_entries'),
  };
}
function tagNames(ctx: TestContext, entryId: unknown): string[] {
  return ctx.db.prepare('SELECT tags.name FROM time_entry_tags JOIN tags ON tags.id = time_entry_tags.tag_id WHERE time_entry_id = ? ORDER BY tags.name')
    .all(entryId as number).map((row) => String(row.name));
}
/**
 * A stopped entry that is snapped. One that lasted under half a step sits in the trash at zero
 * length; any other is kept.
 */
function assertStopped(row: Row, exactStart?: number) {
  assertSnapped(row, exactStart);
  if (row.stop === row.start) assert.notEqual(row.deleted_at, null, 'a zero-length entry is in the trash');
  else assert.equal(row.deleted_at, null, 'a longer entry is kept');
}
const without = (row: Row, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

/** The instances' time resolution, set in the fixture, on the UTC clock of the fixture accounts. */
const RESOLUTION_MINUTES = 1;
const RESOLUTION_MS = RESOLUTION_MINUTES * 60_000;

/**
 * A stopped entry snapped to the time resolution: start on the grid, a whole number of steps long
 * (zero for one the server sent to the trash as too short), and, when the exact start is known,
 * within half a step of it.
 */
function assertSnapped(row: Row, exactStart?: number) {
  const start = Date.parse(String(row.start));
  const stop = Date.parse(String(row.stop));
  assert.equal(start % RESOLUTION_MS, 0, `start ${row.start} is on the grid`);
  assert.ok(stop >= start, `${row.start} to ${row.stop}`);
  assert.equal((stop - start) % RESOLUTION_MS, 0, `${row.start} to ${row.stop} is a whole number of steps`);
  if (exactStart !== undefined) {
    assert.ok(Math.abs(start - exactStart) <= RESOLUTION_MS / 2, `${row.start} near ${new Date(exactStart).toISOString()}`);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function listen(server: Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

/** Whether a request or a reply is an event stream, which the proxy passes through as it arrives. */
const isEventStream = (value: string | null | undefined) => (value ?? '').startsWith('text/event-stream');

/**
 * Copies an event stream to `res` chunk by chunk, and cancels the upstream when the client leaves.
 * While the instance's streams are stalled, what the server sends waits in order, so a client sees
 * a stream that has gone silent, also when the server ends it.
 */
function pipeStream(answer: Response, res: ServerResponse, instance: Instance) {
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'cache-control', 'x-accel-buffering']) {
    const value = answer.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  res.writeHead(answer.status, headers);
  res.flushHeaders();
  const upstream = Readable.fromWeb(answer.body as WebReadableStream<Uint8Array>);
  const forward = (action: () => void) => {
    if (instance.streamsStalled) instance.stalled.push(action);
    else action();
  };
  upstream.on('data', (chunk: Buffer) => forward(() => !res.destroyed && res.write(chunk)));
  upstream.on('end', () => forward(() => !res.destroyed && res.end()));
  upstream.on('error', () => res.destroy());
  res.on('close', () => upstream.destroy());
}

function stallStreams(instance: Instance, stalled: boolean) {
  instance.streamsStalled = stalled;
  if (stalled) return;
  for (const action of instance.stalled.splice(0)) action();
}

/**
 * Forwards to the instance's app. A reply matching an armed hold waits for release or drop; an
 * event stream is never held, and its bytes go to the client as they come.
 */
function proxy(instance: Instance): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readBody(req);
      const method = req.method ?? 'GET';
      const path = (req.url ?? '/').split('?')[0]!;
      const streamRequest = isEventStream(req.headers.accept);
      instance.seen.push({ method, path });
      const holdIndex = streamRequest ? -1 : instance.holds.findIndex((hold) => hold.method === method && hold.path === path);
      if (holdIndex >= 0) instance.holds.splice(holdIndex, 1);

      const answer = await instance.admin.request(method, req.url ?? '/', body === '' ? undefined : body,
        { authorization: req.headers.authorization ?? '', ...(streamRequest ? { accept: 'text/event-stream' } : {}) });
      if (answer.body && isEventStream(answer.headers.get('content-type'))) {
        pipeStream(answer, res, instance);
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'retry-after', 'location']) {
        const value = answer.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      const payload = Buffer.from(await answer.arrayBuffer());
      const send = () => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(answer.status, headers);
        res.end(payload);
      };
      // The reply is cut off before its last byte. A connection that closes before any byte of the
      // reply makes Qt send the request again by itself, which no client of it can tell apart or stop.
      const drop = () => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(answer.status, { ...headers, 'content-length': String(payload.length) });
        res.flushHeaders();
        res.write(payload.subarray(0, Math.max(0, payload.length - 1)), () => res.destroy());
      };
      if (holdIndex >= 0) instance.held.push({ send, drop });
      else send();
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify(String(error)));
    }
  });
}

test('the KDE companion against real Tokkl servers', async (t) => {
  const command = process.env.TOKKL_KDE_REALSERVER_COMMAND;
  assert.ok(command, 'Set TOKKL_KDE_REALSERVER_COMMAND to a JSON array that runs realservertest (see desktop/kde/ci/realserver.sh)');
  const argv = JSON.parse(command) as unknown;
  assert.ok(Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === 'string'), 'TOKKL_KDE_REALSERVER_COMMAND must be a JSON array of strings');

  const a = await seed('a', true);
  const b = await seed('b', false);
  const instances: Record<string, Instance> = {
    a: { name: 'a', admin: a.admin, holds: [], held: [], streamsStalled: false, stalled: [], seen: [] },
    b: { name: 'b', admin: b.admin, holds: [], held: [], streamsStalled: false, stalled: [], seen: [] },
  };
  const users = { ...a.users, ...b.users };
  const contexts = { ...a.contexts, ...b.contexts };
  const before = { a: snapshot(a.admin), b: snapshot(b.admin) };

  // The ids collide across instances by construction; the binary checks them too.
  assert.equal(users['a.s']!.id, users['b.s']!.id);
  assert.equal(users['a.s']!.running!.id, users['b.s']!.running!.id);

  const control = createServer(async (req, res) => {
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const instance = instances[String(body.instance)];
      let answer: unknown;
      switch (req.url) {
        case '/hold':
          instance!.holds.push({ method: String(body.method), path: String(body.path) });
          answer = { armed: true };
          break;
        case '/held':
          answer = { held: instance!.held.length };
          break;
        case '/release': {
          const held = instance!.held.splice(0);
          for (const { send } of held) send();
          answer = { released: held.length };
          break;
        }
        case '/seen':
          answer = { seen: instance!.seen.filter((request) => request.method === body.method && request.path === body.path).length };
          break;
        case '/stall-streams':
          stallStreams(instance!, body.on === true);
          answer = { stalled: instance!.streamsStalled };
          break;
        case '/drop': {
          // The server already acted; the client never gets the whole answer.
          const held = instance!.held.splice(0);
          for (const { drop } of held) drop();
          answer = { dropped: held.length };
          break;
        }
        case '/call': {
          // A request from another device of the same account, straight to the app.
          const response = await contexts[String(body.user)]!.json(String(body.method), String(body.path), body.body);
          answer = { status: response.status, body: response.body };
          break;
        }
        case '/disable': {
          const target = contexts[String(body.user)]!;
          const adminContext = instances[users[String(body.user)]!.instance]!.admin;
          await ok(adminContext, 'PATCH', `/api/app/admin/users/${target.user.id}`, { disabled: true });
          answer = { disabled: target.user.id };
          break;
        }
        case '/remove-membership': {
          // No API removes a member yet, so this edits the database the way a removal would.
          const target = contexts[String(body.user)]!;
          const removed = target.db.prepare('DELETE FROM workspace_users WHERE workspace_id = ? AND user_id = ?')
            .run(Number(body.wid), target.user.id).changes;
          assert.equal(removed, 1);
          answer = { removed };
          break;
        }
        default:
          res.writeHead(404).end();
          return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify(String(error)));
    }
  });

  const basePort = Number(process.env.TOKKL_KDE_TEST_PORT ?? 0);
  const servers = [proxy(instances.a!), proxy(instances.b!), control];
  try {
    instances.a!.url = await listen(servers[0]!, basePort && basePort);
    instances.b!.url = await listen(servers[1]!, basePort && basePort + 1);
    const controlUrl = await listen(servers[2]!, basePort && basePort + 2);
    const fixture = { control: controlUrl, instances: { a: instances.a!.url, b: instances.b!.url }, users };

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(argv[0] as string, argv.slice(1) as string[], {
        env: { ...process.env, TOKKL_REALSERVER_FIXTURE: JSON.stringify(fixture) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), RUN_TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => process.stderr.write(chunk));
      child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(exitCode, 0, 'realservertest failed; its output is above');
  } finally {
    for (const instance of Object.values(instances)) {
      stallStreams(instance, false);
      for (const { send } of instance.held.splice(0)) send();
    }
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  }

  await t.test('instance a changed only where the companion was allowed to', () => {
    const after = snapshot(a.admin);
    const u = users['a.u']!;
    const p = users['a.p']!;
    const q = users['a.q']!;
    const disabled = new Set([users['a.dt']!.id, users['a.dp']!.id]);

    // p deleted its task and its project while paused.
    const deletedProjects = new Set([p.running!.project_id]);
    assert.deepEqual(after.projects, before.a.projects.filter((row) => !deletedProjects.has(row.id as number)));
    assert.deepEqual(after.tasks, before.a.tasks.filter((row) => row.id !== p.running!.task_id));
    assert.deepEqual(after.workspaces, before.a.workspaces);
    assert.deepEqual(after.memberships, before.a.memberships.filter((row) =>
      !(row.workspace_id === users['a.m']!.wid && row.user_id === users['a.m']!.id)));
    assert.equal(after.users.length, before.a.users.length);
    for (const [i, row] of after.users.entries()) {
      const old = before.a.users[i]!;
      if (disabled.has(row.id as number)) {
        assert.notEqual(row.disabled_at, null);
        assert.deepEqual(without(row, 'disabled_at', 'updated_at'), without(old, 'disabled_at', 'updated_at'));
      } else {
        assert.deepEqual(row, old);
      }
    }

    // Every other account's entries, the admin's running one included, are untouched.
    const changed = new Set([u, p, q, ...['sn', 'pc', 'pu', 'hd'].map((key) => users[`a.${key}`]!)].map((user) => user.id));
    const others = (row: Row) => !changed.has(row.user_id as number);
    assert.deepEqual(after.entries.filter(others), before.a.entries.filter(others));
    // u started and stopped one entry, and the start answered late created another.
    const mine = after.entries.filter((row) => row.user_id === u.id);
    assert.equal(before.a.entries.filter((row) => row.user_id === u.id).length, 0);
    assert.equal(mine.length, 2);
    for (const row of mine) {
      assert.equal(row.workspace_id, u.wid);
      assert.equal(row.created_with, 'tokkl-kde');
    }
    assert.equal(mine.filter((row) => row.stop === null).length, 1);
    // The entry it stopped is snapped to the time resolution; the running one keeps its exact start.
    // It stopped seconds after it started, under half a step, so it went to the trash at zero length.
    const stopped = mine.find((row) => row.stop !== null)!;
    assertSnapped(stopped);
    assert.equal(stopped.stop, stopped.start);
    assert.notEqual(stopped.deleted_at, null);

    // p paused the seeded entry and resumed a clone of it, which it paused seconds later: the
    // server sent that clone to the trash at zero length. After the task and the project were
    // deleted, a second clone started without them and was paused the same way, and the chain was
    // discarded. The deletions left all three entries without a project or task; everything else
    // the clones copied is still there.
    const chain = after.entries.filter((row) => row.user_id === p.id);
    const original = before.a.entries.find((row) => row.id === p.running!.id)!;
    assert.equal(chain.length, 3);
    assert.equal(chain[0]!.id, p.running!.id);
    assert.deepEqual(without(chain[0]!, 'start', 'stop', 'duration', 'updated_at', 'project_id', 'task_id'),
      without(original, 'start', 'stop', 'duration', 'updated_at', 'project_id', 'task_id'));
    assertSnapped(chain[0]!, Date.parse(String(original.start)));
    assert.equal(chain[0]!.deleted_at, null);
    for (const clone of chain.slice(1)) {
      assertSnapped(clone);
      assert.ok(Date.parse(String(clone.start)) >= Date.parse(String(chain[0]!.stop)), 'the clone starts after the pause');
      assert.equal(clone.stop, clone.start);
      assert.notEqual(clone.deleted_at, null);
      // The server made the clone, so it has no client name.
      assert.equal(clone.created_with, 'api');
    }
    for (const row of chain) {
      assert.equal(row.workspace_id, p.wid);
      assert.equal(row.description, p.running!.description);
      assert.equal(row.billable, 1);
      assert.equal(row.project_id, null);
      assert.equal(row.task_id, null);
      assert.deepEqual(tagNames(a.admin, row.id), p.running!.tags);
    }

    // q paused its seeded entry. Another device resumed it, and the companion's resume on a stale
    // revision was refused, so the one clone is the other device's; the companion stopped it,
    // which sent it to the trash at zero length. The project is untouched.
    const qChain = after.entries.filter((row) => row.user_id === q.id);
    const qOriginal = before.a.entries.find((row) => row.id === q.running!.id)!;
    assert.equal(qChain.length, 2);
    assert.equal(qChain[0]!.id, q.running!.id);
    assert.equal(qOriginal.stop, null);
    assert.deepEqual(without(qChain[0]!, 'start', 'stop', 'duration', 'updated_at'), without(qOriginal, 'start', 'stop', 'duration', 'updated_at'));
    assertStopped(qChain[0]!, Date.parse(String(qOriginal.start)));
    assert.equal(qChain[0]!.project_id, q.running!.project_id);
    assertStopped(qChain[1]!);
    assert.equal(qChain[1]!.stop, qChain[1]!.start);
    assert.equal(qChain[1]!.project_id, q.running!.project_id);
    assert.equal(qChain[1]!.created_with, 'api');

    // sn ran a session: two pomodoros, the first ended by the second Next phase and the second by
    // End session, both with the project and billable flag the session started with.
    const sn = users['a.sn']!;
    const session = after.entries.filter((row) => row.user_id === sn.id);
    assert.equal(before.a.entries.filter((row) => row.user_id === sn.id).length, 0);
    assert.equal(session.length, 2);
    for (const row of session) {
      assertStopped(row);
      assert.equal(row.workspace_id, sn.wid);
      assert.equal(row.project_id, sn.projects[0]!.id);
      assert.equal(row.billable, 1);
      assert.equal(row.created_with, 'tokkl-kde');
    }
    assert.notEqual(session[0]!.id, session[1]!.id);

    // pc paused, resumed one clone, paused it and discarded the chain: the seeded entry stopped
    // on the grid and the clone, which ran for seconds, in the trash.
    const pc = users['a.pc']!;
    const pcChain = after.entries.filter((row) => row.user_id === pc.id);
    const pcOriginal = before.a.entries.find((row) => row.id === pc.running!.id)!;
    assert.equal(pcChain.length, 2);
    assert.equal(pcChain[0]!.id, pc.running!.id);
    assert.deepEqual(without(pcChain[0]!, 'start', 'stop', 'duration', 'updated_at'), without(pcOriginal, 'start', 'stop', 'duration', 'updated_at'));
    assertStopped(pcChain[0]!, Date.parse(String(pcOriginal.start)));
    assert.ok(Date.parse(String(pcChain[0]!.stop)) > Date.parse(String(pcChain[0]!.start)), 'the seeded entry kept its hour');
    assertStopped(pcChain[1]!);
    assert.equal(pcChain[1]!.stop, pcChain[1]!.start);
    assert.equal(pcChain[1]!.description, pc.running!.description);
    assert.equal(pcChain[1]!.project_id, pc.running!.project_id);
    assert.equal(pcChain[1]!.billable, 1);

    // pu's session was started, advanced and ended through the API: one pomodoro, none of the
    // companion's own writes.
    const pu = users['a.pu']!;
    const pushed = after.entries.filter((row) => row.user_id === pu.id);
    assert.equal(pushed.length, 1);
    assertStopped(pushed[0]!);
    assert.equal(pushed[0]!.created_with, 'api');

    // hd paused once; the reply was lost and the pause was never sent again. A second pause would
    // have been refused, and no clone exists.
    const hd = users['a.hd']!;
    const hdChain = after.entries.filter((row) => row.user_id === hd.id);
    const hdOriginal = before.a.entries.find((row) => row.id === hd.running!.id)!;
    assert.equal(hdChain.length, 1);
    assert.equal(hdChain[0]!.id, hd.running!.id);
    assert.deepEqual(without(hdChain[0]!, 'start', 'stop', 'duration', 'updated_at'), without(hdOriginal, 'start', 'stop', 'duration', 'updated_at'));
    assertStopped(hdChain[0]!, Date.parse(String(hdOriginal.start)));
    assert.ok(Date.parse(String(hdChain[0]!.stop)) > Date.parse(String(hdChain[0]!.start)), 'the seeded entry kept its hour');
  });

  await t.test('instance b changed only by the stop sent after the switch', () => {
    const after = snapshot(b.admin);
    const stopped = users['b.s']!.running!.id;
    assert.deepEqual(after.users, before.b.users);
    assert.deepEqual(after.projects, before.b.projects);
    assert.deepEqual(after.memberships, before.b.memberships);
    assert.deepEqual(after.entries.filter((row) => row.id !== stopped), before.b.entries.filter((row) => row.id !== stopped));
    const row = after.entries.find((entry) => entry.id === stopped)!;
    const old = before.b.entries.find((entry) => entry.id === stopped)!;
    assert.equal(old.stop, null);
    assert.notEqual(row.stop, null);
    // Stopping snaps the entry to the time resolution, so its start moves to the nearest grid point.
    assert.deepEqual(without(row, 'start', 'stop', 'duration', 'updated_at'), without(old, 'start', 'stop', 'duration', 'updated_at'));
    assertSnapped(row, Date.parse(String(old.start)));
  });
});
