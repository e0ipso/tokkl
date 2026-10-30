import { after, type TestContext as NodeTestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { storageFor, filenameFor, storageConfigFor, setServices, reopenDatabase } from './fixtures/database.ts';
import { copySQLiteFile } from './fixtures/physical.ts';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/crypto.ts';
import { FailureLimiter, type Keys } from '../src/auth/rateLimit.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, transaction, type FixtureDatabase } from './fixtures/database.ts';
import { createFirstAdmin, insertAccount, type UserRole, type User } from './fixtures/domain.ts';

export interface TestContext {
  db: FixtureDatabase;
  user: User;
  wid: number;
  request: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  json: <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T; headers: Headers }>;
}

export const PASSWORD = 'correct horse battery';
/** The header the web client sends on every request; session-starting and cookie-authenticated writes need it. */
export const CSRF = { 'x-tokkl-csrf': '1' };

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
  // Bulk SQLite fixture writes can keep timers from firing before the next pooled request.
  server.keepAliveTimeout = 60_000;
  servers.add(server);
  const ready = new Promise<number>((resolve) => server.once('listening', () => resolve((server.address() as AddressInfo).port)));
  return {
    request: async (path, init) => fetch(`http://127.0.0.1:${await ready}${path}`, init),
  };
}

export function testConfig(db?: FixtureDatabase): Config {
  return {
    port: 0, host: '127.0.0.1', dataDir: '/nonexistent', storage: db ? storageConfigFor(db) : {backend:'sqlite',filename:':memory:',busyTimeoutMs:5000}, webRoot: '/nonexistent',
    trustProxy: false, sessionDays: 30, setupCode: undefined,
  };
}

export async function setup(options: { timezone?: string; sqlite?: boolean } = {}): Promise<TestContext> {
  const db = (await openDatabase(options.sqlite ? ':memory:' : undefined));
  const user = (await createFirstAdmin(db, {
    email: 'me@example.com', password: PASSWORD, fullname: 'Test User', timezone: options.timezone ?? 'UTC',
  }));
  return serve(db, user);
}

/** The app serving each database, so every user of one database talks to the same app and its limiters. */
const apps = new WeakMap<FixtureDatabase, TestServer>();

/**
 * Adds another account to the database behind `ctx`, with its own workspace that it owns, and
 * returns a context signed in as that account on the same app. The password is PASSWORD. It writes
 * the account the way an accepted invite does, without the invite round trip.
 */
export async function addUser(
  ctx: TestContext,
  options: { email: string; role: UserRole; fullname?: string; timezone?: string },
): Promise<TestContext> {
  const { db } = ctx;
  const passwordHash = await hashPassword(PASSWORD);
  const user = (await insertAccount(db, {
    email: options.email, fullname: options.fullname ?? '', timezone: options.timezone ?? 'UTC',
    passwordHash, role: options.role,
  }));
  return serve(db, user);
}

/**
 * Signs `ctx.user` in through `/api/app/login` with PASSWORD and returns the `tokkl_session=...`
 * pair to send as a cookie. Pass `authorization: ''` with it, or the API token still signs the request in.
 */
export async function sessionCookie(ctx: TestContext): Promise<string> {
  const response = await ctx.request('POST', '/api/app/login', { email: ctx.user.email, password: PASSWORD }, { authorization: '', ...CSRF });
  if (response.status !== 200) throw new Error(`Login as ${ctx.user.email} failed with ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

/** Serves `db` (reusing its app if it has one) and signs every request in as `user` with its API token. */
function serve(db: FixtureDatabase, user: User): TestContext {
  let app = apps.get(db);
  if (!app) { const application=createApp({ storage:storageFor(db),config:testConfig(db),setup:{code:null} }); setServices(db,application.locals.services); app=testServer(application); after(()=>application.locals.close()); }
  apps.set(db, app);
  const auth = `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}`;
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    (apps.get(db) ?? app!).request(path, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const json = async (method: string, path: string, body?: unknown) => {
    const response = await request(method, path, body);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return { db, user, wid: user.defaultWorkspaceId, request, json };
}

/**
 * Copies the context's database into a file in a temporary directory and serves a second app over
 * the copy, signed in as the same user. The copy holds the same rows, so both apps must answer the
 * same requests identically. Report jobs on the copy run in the report worker, which needs a file;
 * jobs on an in-memory database run inline. The directory is removed when the test file ends.
 */
export async function fileBackedCopy(ctx: TestContext): Promise<TestContext & { path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-test-'));
  const path = join(dir, 'tokkl.db');
  await copySQLiteFile(ctx.db, path);
  const db = (await openDatabase(path));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...serve(db, ctx.user), path };
}

export function iso(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Runs `during` once, after the next password check has passed and before the request goes on,
 * as if another request committed while scrypt ran. Requests signed in by API token run no check.
 */
export function duringPasswordCheck(t: NodeTestContext, during: () => Promise<unknown>): void {
  const attempt = FailureLimiter.prototype.attempt;
  let pending = true;
  t.mock.method(FailureLimiter.prototype, 'attempt', function (this: FailureLimiter, keys: Keys, check: () => Promise<boolean>) {
    return attempt.call(this, keys, async () => {
      const valid = await check();
      if (pending) {
        pending = false;
        await during();
      }
      return valid;
    });
  });
}

export function replaceFixtureApp(ctx:TestContext,options:import('../src/services/timerStreams.ts').TimerStreamOptions) {const app=createApp({storage:storageFor(ctx.db),config:testConfig(ctx.db),setup:{code:null},timerStreamOptions:options});setServices(ctx.db,app.locals.services);after(()=>app.locals.close());const server=testServer(app);apps.set(ctx.db,server);return {streams:app.locals.services.timerStreams as import('../src/services/timerStreams.ts').TimerStreams,server};}

/** A second app/storage instance for report isolation; SQLite additionally exercises file-copy workers. */
export async function independentReportServer(ctx: TestContext): Promise<TestContext> {
  if (ctx.db.backend === 'sqlite') return fileBackedCopy(ctx);
  return serve(await reopenDatabase(ctx.db), ctx.user);
}
