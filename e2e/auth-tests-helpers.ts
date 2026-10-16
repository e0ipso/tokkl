import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { test as base } from './fixtures.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Disposable servers use E2E_PORT + 50 to + 59, so concurrent runs on other E2E_PORT values do not collide.
const FIRST_PORT = Number(process.env.E2E_PORT ?? 8095) + 50;
const DAY_MS = 86_400_000;

export const SETUP_CODE = 'AUTH-TESTS-SETUP';
/** The header the web client sends; login, setup and invite acceptance refuse requests without it. */
export const CSRF = { 'X-Tokkl-CSRF': '1' };
export const ACCOUNT = { email: 'owner@auth.example', password: 'first password 1', fullname: 'Auth Owner' };

export interface ServerOptions {
  /** 0 to 9, picks the port E2E_PORT + 50 + slot. */
  slot: number;
  /** Reuse a data directory from an earlier start, to restart the same account. */
  dataDir?: string;
  /** Shifts only the server's Date by this many milliseconds, so session expiry needs no waiting. */
  clockShiftMs?: number;
}

export interface DisposableServer {
  baseURL: string;
  dataDir: string;
  /** Everything the server process has written to stdout and stderr so far. */
  output: () => string;
  stop: () => Promise<void>;
}

/** Replaces Date in the server process with one that runs `shiftMs` ahead. Nothing else changes. */
function clockShiftImport(shiftMs: number): string {
  const code = `
    const RealDate = Date;
    const shift = ${shiftMs};
    globalThis.Date = class ShiftedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + shift); else super(...args); }
      static now() { return RealDate.now() + shift; }
    };`;
  return `data:text/javascript,${encodeURIComponent(code)}`;
}

async function waitForHealth(baseURL: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable server exited with ${child.exitCode}:\n${log()}`);
    try {
      if ((await fetch(`${baseURL}/healthz`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable server at ${baseURL} did not become healthy:\n${log()}`);
}

async function startServer(options: ServerOptions): Promise<DisposableServer> {
  const port = FIRST_PORT + options.slot;
  const baseURL = `http://127.0.0.1:${port}`;
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'tokkl-e2e-auth-'));
  const args = options.clockShiftMs ? ['--import', clockShiftImport(options.clockShiftMs)] : [];
  const child = spawn(process.execPath, [...args, 'packages/api/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TOKKL_DATA_DIR: dataDir, TOKKL_SETUP_CODE: SETUP_CODE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk) => { output += chunk; });
  child.stderr!.on('data', (chunk) => { output += chunk; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  };
  try {
    await waitForHealth(baseURL, child, () => output);
  } catch (error) {
    await stop();
    throw error;
  }
  return { baseURL, dataDir, output: () => output, stop };
}

/** Starts disposable servers for one scenario; stops them and deletes their data afterwards. */
export class ServerPool {
  private readonly running: DisposableServer[] = [];
  private readonly dataDirs = new Set<string>();

  async start(options: ServerOptions): Promise<DisposableServer> {
    const server = await startServer(options);
    this.running.push(server);
    this.dataDirs.add(server.dataDir);
    return server;
  }

  async dispose(): Promise<void> {
    for (const server of this.running.splice(0)) await server.stop();
    for (const dir of this.dataDirs) rmSync(dir, { recursive: true, force: true });
  }
}

export const test = base.extend<{ servers: ServerPool }>({
  servers: async ({}, use) => {
    const pool = new ServerPool();
    try {
      await use(pool);
    } finally {
      await pool.dispose();
    }
  },
});

export { expect };

export function days(count: number): number {
  return count * DAY_MS;
}

/** Password and setup code counters run over a 15-minute window (packages/api/src/auth/rateLimit.ts). */
export const LIMIT_WINDOW_SECONDS = 15 * 60;

/** The whole seconds a limiter 429 says to wait (TT-0160): an integer from 1 to the window. */
export function retryAfter(response: { headers(): Record<string, string> }): number {
  const value = response.headers()['retry-after'];
  expect(value, 'a 429 carries Retry-After').toMatch(/^\d+$/);
  const seconds = Number(value);
  expect(seconds).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeLessThanOrEqual(LIMIT_WINDOW_SECONDS);
  return seconds;
}

export function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/** Creates the account on a fresh disposable server through the API and returns its API token. */
export async function createAccount(baseURL: string): Promise<{ apiToken: string }> {
  const api = await request.newContext({ baseURL });
  try {
    const setup = await api.post('/api/app/setup', { headers: CSRF, data: { setup_code: SETUP_CODE, ...ACCOUNT, timezone: 'Europe/Madrid' } });
    expect(setup.status()).toBe(200);
    const me = await api.get('/api/v9/me');
    expect(me.status()).toBe(200);
    return { apiToken: (await me.json()).api_token };
  } finally {
    await api.dispose();
  }
}

/** Runs `use` with a request context that sends the given Authorization header, then disposes it. */
export async function withAuth<T>(baseURL: string, authorization: string, use: (api: APIRequestContext) => Promise<T>): Promise<T> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { authorization } });
  try {
    return await use(api);
  } finally {
    await api.dispose();
  }
}

/** Creates an invite as an admin, through the API, and returns its /invite/<token> path. */
export async function createInvite(baseURL: string, apiToken: string, role: 'admin' | 'user'): Promise<string> {
  return withAuth(baseURL, basic(apiToken, 'api_token'), async (api) => {
    const response = await api.post('/api/app/admin/invites', { data: { role } });
    expect(response.status()).toBe(200);
    const { url } = await response.json() as { url: string };
    expect(url).toMatch(/^\/invite\/[\w-]+$/);
    return url;
  });
}

/**
 * Issues a password reset link for the account with `email`, as an admin through the API, and
 * returns its /reset/<token> path.
 */
export async function createPasswordReset(baseURL: string, apiToken: string, email: string): Promise<string> {
  return withAuth(baseURL, basic(apiToken, 'api_token'), async (api) => {
    const users = await (await api.get('/api/app/admin/users')).json() as Array<{ id: number; email: string }>;
    const user = users.find((account) => account.email === email);
    expect(user, `an account for ${email}`).toBeDefined();
    const response = await api.post(`/api/app/admin/users/${user!.id}/password-reset`);
    expect(response.status()).toBe(200);
    const { url } = await response.json() as { url: string };
    expect(url).toMatch(/^\/reset\/[\w-]+$/);
    return url;
  });
}

/** The API path behind an /invite/<token> link: GET looks the invite up, POST accepts it. */
export function inviteApiPath(invite: string): string {
  return invite.replace(/^\/invite\//, '/api/app/invites/');
}

/** The API path behind a /reset/<token> link: GET looks the link up, POST sets the password. */
export function resetApiPath(reset: string): string {
  return reset.replace(/^\/reset\//, '/api/app/password-resets/');
}

export interface InvitedAccount {
  email: string;
  password: string;
  apiToken: string;
  workspaceId: number;
  /** The tokkl_session cookie value the acceptance set. */
  session: string;
}

/** Accepts an invite over the API, as the web form does, and returns the new account's credentials. */
export async function acceptInvite(baseURL: string, invite: string, email: string): Promise<InvitedAccount> {
  const password = `${email} password`;
  const api = await request.newContext({ baseURL });
  try {
    const accept = await api.post(inviteApiPath(invite), {
      headers: CSRF, data: { email, password, fullname: email, timezone: 'Europe/Madrid' },
    });
    expect(accept.status()).toBe(200);
    const session = (await api.storageState()).cookies.find((c) => c.name === 'tokkl_session')!.value;
    const me = await (await api.get('/api/v9/me')).json() as { api_token: string; default_workspace_id: number };
    return { email, password, apiToken: me.api_token, workspaceId: me.default_workspace_id, session };
  } finally {
    await api.dispose();
  }
}

/** Logs in through the form and waits for the timer page. */
export async function logInThroughForm(page: Page, baseURL: string, password = ACCOUNT.password): Promise<void> {
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Email').fill(ACCOUNT.email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('region', { name: 'Timer' })).toBeVisible();
}

/** Status of GET /api/v9/me sent with only the given session cookie, from outside any browser. */
export async function meWithSession(baseURL: string, session: string): Promise<number> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { cookie: `tokkl_session=${session}` } });
  try {
    return (await api.get('/api/v9/me')).status();
  } finally {
    await api.dispose();
  }
}

/** Status of GET /api/v9/me with HTTP Basic credentials and no cookie. */
export async function meWithBasic(baseURL: string, authorization: string): Promise<number> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { authorization } });
  try {
    return (await api.get('/api/v9/me')).status();
  } finally {
    await api.dispose();
  }
}

export async function sessionCookie(page: Page, baseURL: string): Promise<string> {
  const cookie = (await page.context().cookies(baseURL)).find((c) => c.name === 'tokkl_session');
  expect(cookie, 'the browser holds a session cookie').toBeDefined();
  return cookie!.value;
}
