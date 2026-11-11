import { after, type TestContext as NodeTestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { TimerState } from '@tokkl/types';
import { storageFor, storageConfigFor, setServices, reopenDatabase } from './fixtures/database.ts';
import { copySQLiteFile } from './fixtures/physical.ts';
import { composeApp, streamSettings } from './fixtures/app.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { FailureLimiter, type AttemptResult, type Keys } from '../src/auth/rateLimit.ts';
import type { Config } from '../src/config.ts';
import { openDatabase, type FixtureDatabase } from './fixtures/database.ts';
import { createFirstAdmin, insertAccount, type UserRole, type User } from './fixtures/domain.ts';

export interface TestContext {
  db: FixtureDatabase;
  user: User;
  wid: number;
  request: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  json: <T = any>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: T; headers: Headers }>;
}

export const PASSWORD = 'correct horse battery';

export async function until(condition: () => boolean | Promise<boolean>, what = 'the condition', ms = 10_000) {
  const deadline = performance.now() + ms;
  while (!(await condition())) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export const anonymous = (
  ctx: TestContext,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) => ctx.request(method, path, body, { authorization: '', ...headers });

export const login = (ctx: TestContext, email: string, password = PASSWORD) =>
  anonymous(ctx, 'POST', '/api/app/login', { email, password }, CSRF);

export function recordLogs(t: NodeTestContext): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = [];
  const keep = (line: unknown) => void lines.push(JSON.parse(String(line)));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  return lines;
}
/** Session-starting and cookie-authenticated writes need it. */
export const CSRF = { 'x-tokkl-csrf': '1' };

export const timerState = async (ctx: TestContext) => (await ctx.json<TimerState>('GET', '/api/app/timer')).body;

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

export function testServer(app: Express): TestServer {
  const server = app.listen(0, '127.0.0.1');
  // Bulk SQLite fixture writes can keep timers from firing before the next pooled request.
  server.keepAliveTimeout = 60_000;
  servers.add(server);
  const ready = new Promise<number>(resolve =>
    server.once('listening', () => resolve((server.address() as AddressInfo).port)),
  );
  return {
    request: async (path, init) => fetch(`http://127.0.0.1:${await ready}${path}`, init),
  };
}

export function testConfig(db?: FixtureDatabase): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/nonexistent',
    storage: db ? storageConfigFor(db) : { backend: 'sqlite', filename: ':memory:', busyTimeoutMs: 5000 },
    webRoot: '/nonexistent',
    trustProxy: false,
    sessionDays: 30,
    setupCode: undefined,
    publicUrl: undefined,
    smtp: undefined,
    mail: { configured: false, missing: ['TOKKL_SMTP_HOST', 'TOKKL_SMTP_FROM', 'TOKKL_PUBLIC_URL'] },
    // Request lines would drown the test output; failures still print.
    logLevel: 'warn',
  };
}

export async function setup(options: { timezone?: string; sqlite?: boolean } = {}): Promise<TestContext> {
  const db = await openDatabase(options.sqlite ? ':memory:' : undefined);
  const user = await createFirstAdmin(db, {
    email: 'me@example.com',
    password: PASSWORD,
    fullname: 'Test User',
    timezone: options.timezone ?? 'UTC',
  });
  return serve(db, user);
}

/** So every user of one database talks to the same app and its limiters. */
const apps = new WeakMap<FixtureDatabase, TestServer>();

/** Written the way an accepted invite writes it, with its own workspace. The password is PASSWORD. */
export async function addUser(
  ctx: TestContext,
  options: { email: string; role: UserRole; fullname?: string; timezone?: string },
): Promise<TestContext> {
  const { db } = ctx;
  const passwordHash = await hashPassword(PASSWORD);
  const user = await insertAccount(db, {
    email: options.email,
    fullname: options.fullname ?? '',
    timezone: options.timezone ?? 'UTC',
    passwordHash,
    role: options.role,
  });
  return serve(db, user);
}

/** Pass `authorization: ''` with it, or the API token still signs the request in. */
export async function sessionCookie(ctx: TestContext): Promise<string> {
  const response = await ctx.request(
    'POST',
    '/api/app/login',
    { email: ctx.user.email, password: PASSWORD },
    { authorization: '', ...CSRF },
  );
  if (response.status !== 200) throw new Error(`Login as ${ctx.user.email} failed with ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

function serve(db: FixtureDatabase, user: User): TestContext {
  let app = apps.get(db);
  if (!app) {
    const application = composeApp({
      storage: storageFor(db),
      config: testConfig(db),
      setup: { code: null },
    });
    setServices(db, application.services);
    app = testServer(application.app);
    after(() => application.close());
  }
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

/** Both apps must answer identically. Report jobs on the file run in the worker; in-memory ones run inline. */
export async function fileBackedCopy(ctx: TestContext): Promise<TestContext & { path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-test-'));
  const path = join(dir, 'tokkl.db');
  await copySQLiteFile(ctx.db, path);
  const db = await openDatabase(path);
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...serve(db, ctx.user), path };
}

export function iso(value: string): string {
  return new Date(value).toISOString();
}

/** As if another request committed while scrypt ran. API-token requests run no check. */
export function duringPasswordCheck(t: NodeTestContext, during: () => Promise<unknown>): void {
  const attempt = FailureLimiter.prototype.attempt;
  let pending = true;
  t.mock.method(
    FailureLimiter.prototype,
    'attempt',
    function (this: FailureLimiter, keys: Keys, check: () => Promise<boolean>): Promise<AttemptResult> {
      return attempt.call(this, keys, async () => {
        const valid = await check();
        if (pending) {
          pending = false;
          await during();
        }
        return valid;
      });
    },
  );
}

export function replaceFixtureApp(
  ctx: TestContext,
  limits: Partial<import('../src/services/timerStreams.ts').TimerStreamLimits>,
) {
  const { app, services, close } = composeApp({
    storage: storageFor(ctx.db),
    config: testConfig(ctx.db),
    setup: { code: null },
    settings: streamSettings(limits),
  });
  setServices(ctx.db, services);
  after(() => close());
  const server = testServer(app);
  apps.set(ctx.db, server);
  return {
    streams: services.timerStreams,
    server,
  };
}

export async function independentReportServer(ctx: TestContext): Promise<TestContext> {
  if (ctx.db.backend === 'sqlite') return fileBackedCopy(ctx);
  return serve(await reopenDatabase(ctx.db), ctx.user);
}

export const SERVER_API = {
  api_version: 1,
  capabilities: [
    'app-preferences',
    'timer-actions',
    'timer-edit',
    'pomodoro-revision',
    'pause-revision',
    'timer-edit-entry',
    'idempotency-keys',
    'catalog-revision',
    'latest-entry',
  ],
  pomodoro_limits: {
    work_minutes: { min: 1, max: 180, default: 25 },
    short_rest_minutes: { min: 1, max: 60, default: 5 },
    long_rest_minutes: { min: 1, max: 60, default: 15 },
    long_rest_every: { min: 1, max: 12, default: 4 },
  },
} as const;
