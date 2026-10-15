import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, type Db } from '../src/db/index.ts';
import { createOwner, type UserRow } from '../src/models/users.ts';

export interface TestContext {
  db: Db;
  user: UserRow;
  wid: number;
  request: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  json: <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T; headers: Headers }>;
}

export const PASSWORD = 'correct horse battery';

export interface TestServer {
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

const servers = new Set<Server>();
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

/** Serves `app` on a random local port for the rest of the test file. */
export function testServer(app: Express): TestServer {
  const server = app.listen(0, '127.0.0.1');
  servers.add(server);
  const ready = new Promise<number>((resolve) => server.once('listening', () => resolve((server.address() as AddressInfo).port)));
  return {
    request: async (path, init) => fetch(`http://127.0.0.1:${await ready}${path}`, init),
  };
}

export function testConfig(): Config {
  return {
    port: 0, host: '127.0.0.1', dataDir: '/nonexistent', databasePath: ':memory:', webRoot: '/nonexistent',
    trustProxy: false, sessionDays: 30, setupCode: undefined,
  };
}

export async function setup(options: { timezone?: string } = {}): Promise<TestContext> {
  const db = openDatabase(':memory:');
  const user = await createOwner(db, {
    email: 'me@example.com', password: PASSWORD, fullname: 'Test User', timezone: options.timezone ?? 'UTC',
  });
  return serve(db, user);
}

/** Serves an app over `db` and signs every request in as `user` with its API token. */
function serve(db: Db, user: UserRow): TestContext {
  const app = testServer(createApp({ db, config: testConfig(), setup: { code: null } }));
  const auth = `Basic ${Buffer.from(`${user.api_token}:api_token`).toString('base64')}`;
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const json = async (method: string, path: string, body?: unknown) => {
    const response = await request(method, path, body);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return { db, user, wid: user.default_workspace_id, request, json };
}

/**
 * Copies the context's database into a file in a temporary directory and serves a second app over
 * the copy, signed in as the same user. The copy holds the same rows, so both apps must answer the
 * same requests identically. Report jobs on the copy run in the report worker, which needs a file;
 * jobs on an in-memory database run inline. The directory is removed when the test file ends.
 */
export function fileBackedCopy(ctx: TestContext): TestContext & { path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-test-'));
  const path = join(dir, 'tokkl.db');
  ctx.db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  const db = openDatabase(path);
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...serve(db, ctx.user), path };
}

export function iso(value: string): string {
  return new Date(value).toISOString();
}
