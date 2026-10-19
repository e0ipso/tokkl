/**
 * Runs the GNOME Shell extension against a real tokkl-timerd and a real Tokkl server: this serves
 * an instance built with the API's test fixtures on 127.0.0.1, runs the command that drives the
 * extension (realservice-check.js inside a headless GNOME Shell), then checks that the server's
 * data changed only by the entries the panel started, paused, resumed and stopped.
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

  const server = createServer(createApp({ db: admin.db, config: testConfig(), setup: { code: null } }));
  const url = await listen(server, Number(process.env.TOKKL_GNOME_TEST_PORT ?? 0));
  const fixture = { url, token: user.user.api_token, project: { id: project.id, name: project.name, color: project.color } };
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

  await t.test('the server changed only by the entries the panel started, paused, resumed and stopped', () => {
    const after = snapshot(admin);
    assert.deepEqual(after.users, before.users);
    assert.deepEqual(after.workspaces, before.workspaces);
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.projects, before.projects);
    assert.deepEqual(after.entries.filter((row) => row.user_id !== user.user.id), before.entries);

    // The entry the pause stopped, and the clone the resume started and Stop stopped.
    const mine = after.entries.filter((row) => row.user_id === user.user.id);
    assert.equal(mine.length, 2, JSON.stringify(mine));
    for (const entry of mine) {
      assert.equal(entry.workspace_id, user.wid);
      assert.equal(entry.project_id, project.id);
      assert.equal(entry.created_with, 'tokkl-gnome');
      // Started with the project's billable default (false), then switched on while running; the
      // clone copies the paused entry.
      assert.equal(Number(entry.billable), 1);
      assert.notEqual(entry.stop, null);

      // Stopping snapped it to the time resolution.
      const start = Date.parse(String(entry.start));
      const stop = Date.parse(String(entry.stop));
      assert.equal(start % RESOLUTION_MS, 0, `start ${entry.start} is on the grid`);
      assert.ok(stop >= start, `${entry.start} to ${entry.stop}`);
      assert.equal((stop - start) % RESOLUTION_MS, 0, `${entry.start} to ${entry.stop} is a whole number of steps`);
    }
    assert.equal(mine[1]!.description, mine[0]!.description);
  });
});
