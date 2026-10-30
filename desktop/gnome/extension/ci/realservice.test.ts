import { storageFor } from '../../../../packages/api/test/fixtures/database.ts';
/**
 * Runs the GNOME Shell extension against a real tokkl-timerd and a real Tokkl server: this serves
 * an instance built with the API's test fixtures on 127.0.0.1, runs the command that drives the
 * extension (realservice-check.js inside a headless GNOME Shell), then checks that the server's
 * data changed only by the entries the panel started, paused, resumed and stopped, and by the
 * sessions the panel and another device started.
 *
 *   TOKKL_GNOME_REALSERVICE_COMMAND='["docker", "run", ...]' \
 *     node --test desktop/gnome/extension/ci/realservice.test.ts
 *
 * TOKKL_GNOME_REALSERVICE_COMMAND is a JSON array (realservice.sh builds it). The command gets the
 * fixture in the TOKKL_GNOME_FIXTURE environment variable: the server's address, the account's API
 * token and the project to choose. TOKKL_GNOME_TEST_PORT sets the server's port; without it the
 * system picks a free one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../../../packages/api/src/app.ts';
import { addUser, setup, testConfig, type TestContext } from '../../../../packages/api/test/helpers.ts';

const RUN_TIMEOUT_MS = 20 * 60 * 1000;
/** The instance's default time resolution, five minutes, on the UTC clock of the fixture accounts. */
const RESOLUTION_MS = 5 * 60_000;

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

async function ok<T>(ctx: TestContext, method: string, path: string, body?: unknown): Promise<T> {
  const response = await ctx.json<T>(method, path, body);
  assert.ok(response.status >= 200 && response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

function listen(server: Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

test('the GNOME Shell extension against tokkl-timerd and a real Tokkl server', async (t) => {
  const command = process.env.TOKKL_GNOME_REALSERVICE_COMMAND;
  assert.ok(command, 'Set TOKKL_GNOME_REALSERVICE_COMMAND to a JSON array (see desktop/gnome/extension/ci/realservice.sh)');
  const argv = JSON.parse(command) as unknown;
  assert.ok(Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === 'string'),
    'TOKKL_GNOME_REALSERVICE_COMMAND must be a JSON array of strings');

  const admin = await setup();
  // Another account's running entry, which the panel must leave alone.
  await ok(admin, 'POST', `/api/v9/workspaces/${admin.wid}/time_entries`,
    { workspace_id: admin.wid, description: 'admin running', start: new Date(Date.now() - 3_600_000).toISOString(), duration: -1, created_with: 'fixture' });
  const user = await addUser(admin, { email: 'gnome@example.com', role: 'user' });
  const project = await ok<{ id: number; name: string; color: string }>(user, 'POST', `/api/v9/workspaces/${user.wid}/projects`,
    { name: 'GNOME panel project', active: true, color: '#2da608', billable: false });
  await ok(user, 'POST', `/api/v9/workspaces/${user.wid}/projects`, { name: 'Other project', active: true });
  const before = snapshot(admin);

  const server = createServer(createApp({ storage: storageFor(admin.db), config: testConfig(), setup: { code: null } }));
  const url = await listen(server, Number(process.env.TOKKL_GNOME_TEST_PORT ?? 0));
  const fixture = { url, token: user.user.apiToken, project: { id: project.id, name: project.name, color: project.color } };
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(argv[0] as string, argv.slice(1) as string[], {
        env: { ...process.env, TOKKL_GNOME_FIXTURE: JSON.stringify(fixture) },
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
    assert.equal(exitCode, 0, 'the extension check failed; its output is above');
  } finally {
    server.closeAllConnections();
    server.close();
  }

  await t.test('the server changed only by the entries the panel and the other device started, and the sessions ended', () => {
    const after = snapshot(admin);
    assert.deepEqual(after.users, before.users);
    assert.deepEqual(after.workspaces, before.workspaces);
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.projects, before.projects);
    assert.deepEqual(after.entries.filter((row) => row.user_id !== user.user.id), before.entries);

    // The entry the pause stopped, the clone the server started on resume (the pause chain keeps
    // no client name) and Stop stopped, the pomodoro of the session the panel started, and the one
    // of the session another device started.
    const mine = after.entries.filter((row) => row.user_id === user.user.id);
    assert.equal(mine.length, 4, JSON.stringify(mine));
    for (const entry of mine) {
      assert.equal(entry.workspace_id, user.wid);
      assert.notEqual(entry.stop, null);

      // Each ran seconds, under half a step of the time resolution, so stopping it rounded it to zero
      // and sent it to the trash with both ends on the grid point nearest its start.
      const start = Date.parse(String(entry.start));
      assert.equal(start % RESOLUTION_MS, 0, `start ${entry.start} is on the grid`);
      assert.equal(entry.stop, entry.start);
      assert.notEqual(entry.deleted_at, null);
    }
    const [paused, clone, panelSession, otherSession] = mine;
    // Started with the project's billable default (false), then switched on while running; the
    // clone copies the paused entry.
    for (const entry of [paused!, clone!]) {
      assert.equal(entry.project_id, project.id);
      assert.equal(Number(entry.billable), 1);
    }
    assert.equal(paused!.created_with, 'tokkl-gnome');
    assert.equal(clone!.created_with, 'api');
    assert.equal(clone!.description, paused!.description);
    // The panel's session starts on the chosen project; the other device's names none.
    assert.equal(panelSession!.created_with, 'tokkl-gnome');
    assert.equal(panelSession!.project_id, project.id);
    assert.equal(otherSession!.created_with, 'fixture');
    assert.equal(otherSession!.project_id, null);
  });
});
