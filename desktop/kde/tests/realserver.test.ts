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
 * 127.0.0.1 that can hold a reply back, and a control server lets the binary hold and release
 * replies, disable an account and remove a workspace membership. TOKKL_KDE_TEST_PORT sets the
 * first of the three ports; without it the system picks free ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { addUser, PASSWORD, setup, type TestContext } from '../../../packages/api/test/helpers.ts';
import { addWorkspaceMember } from '../../../packages/api/src/models/workspaces.ts';

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

interface Entry { id: number; wid: number; description: string; start: string }
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

/** An instance: its admin's context (and so its database and app) and the proxy in front of it. */
interface Instance {
  name: string;
  admin: TestContext;
  holds: { method: string; path: string }[];
  held: (() => void)[];
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

async function running(ctx: TestContext, wid: number, description: string, start: Date, projectId?: number): Promise<Entry> {
  const entry = await ok<{ id: number; workspace_id: number; description: string; start: string }>(
    ctx, 'POST', `/api/v9/workspaces/${wid}/time_entries`,
    { workspace_id: wid, description, start: start.toISOString(), duration: -1, created_with: 'fixture', project_id: projectId },
  );
  return { id: entry.id, wid: entry.workspace_id, description: entry.description, start: entry.start };
}

function describeUser(instance: string, ctx: TestContext, wid: number, projects: FixtureUser['projects'], entry: Entry | null): FixtureUser {
  return {
    instance, id: ctx.user.id, wid, email: ctx.user.email, token: ctx.user.api_token, password: PASSWORD,
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
  const adminProject = await project(admin, admin.wid, `${label} admin project`);
  const adminEntry = await running(admin, admin.wid, `${label} admin running`, new Date(now - 3 * hour), adminProject.id);
  users[`${name}.admin`] = describeUser(name, admin, admin.wid, [adminProject], adminEntry);
  contexts[`${name}.admin`] = admin;

  const u = await addUser(admin, { email: `u@${name}.example.com`, role: 'user' });
  const uProjects = [await project(u, u.wid, `${label} u first`), await project(u, u.wid, `${label} u second`)];
  users[`${name}.u`] = describeUser(name, u, u.wid, uProjects, null);
  contexts[`${name}.u`] = u;

  const s = await addUser(admin, { email: `s@${name}.example.com`, role: 'user' });
  const sProject = await project(s, s.wid, `${label} s project`);
  const sEntry = await running(s, s.wid, `${label} s running`, new Date(now - (extra ? 2 : 1) * hour), sProject.id);
  users[`${name}.s`] = describeUser(name, s, s.wid, [sProject], sEntry);
  contexts[`${name}.s`] = s;

  if (extra) {
    // Works in the admin's workspace as a member, so it can lose it.
    const m = await addUser(admin, { email: `m@${name}.example.com`, role: 'user' });
    addWorkspaceMember(m.db, admin.wid, m.user.id, 'member');
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
    entries: rows(ctx, 'time_entries'),
  };
}
const without = (row: Row, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

/** The instances' default time resolution, five minutes, on the UTC clock of the fixture accounts. */
const RESOLUTION_MS = 5 * 60_000;

/**
 * A stopped entry snapped to the time resolution: start on the grid, a whole number of steps long
 * (zero for one stopped within the second it started), and, when the exact start is known, within
 * half a step of it.
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

/** Forwards to the instance's app; a reply matching an armed hold waits for release. */
function proxy(instance: Instance): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readBody(req);
      const method = req.method ?? 'GET';
      const path = (req.url ?? '/').split('?')[0];
      const holdIndex = instance.holds.findIndex((hold) => hold.method === method && hold.path === path);
      if (holdIndex >= 0) instance.holds.splice(holdIndex, 1);

      const answer = await instance.admin.request(method, req.url ?? '/', body === '' ? undefined : body,
        { authorization: req.headers.authorization ?? '' });
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
      if (holdIndex >= 0) instance.held.push(send);
      else send();
    } catch (error) {
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
    a: { name: 'a', admin: a.admin, holds: [], held: [] },
    b: { name: 'b', admin: b.admin, holds: [], held: [] },
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
          for (const send of held) send();
          answer = { released: held.length };
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
    for (const instance of Object.values(instances)) for (const send of instance.held.splice(0)) send();
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  }

  await t.test('instance a changed only where the companion was allowed to', () => {
    const after = snapshot(a.admin);
    const u = users['a.u']!;
    const disabled = new Set([users['a.dt']!.id, users['a.dp']!.id]);

    assert.deepEqual(after.projects, before.a.projects);
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
    assert.deepEqual(after.entries.filter((row) => row.user_id !== u.id), before.a.entries.filter((row) => row.user_id !== u.id));
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
    const stopped = mine.find((row) => row.stop !== null)!;
    assertSnapped(stopped);
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
