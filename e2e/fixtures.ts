import { randomUUID } from 'node:crypto';
import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';
import { madridWallClock } from './timer-tests-helpers.ts';

export const EMAIL = 'e2e@example.com';
export const PASSWORD = 'e2e password';
export const SETUP_CODE = 'E2E-SETUP-CODE';

export interface Account {
  email: string;
  password: string;
  fullname: string;
}

/** The first admin of each e2e server. Specs in the instance project sign in as it. */
export const ADMIN_ACCOUNT: Account = { email: EMAIL, password: PASSWORD, fullname: 'E2E User' };

// Global setup deletes worker accounts left by earlier runs, so a run never invites an existing address.
const WORKER_EMAIL = /^worker-[^@]*@e2e\.example$/;

/** Global setup sets this before any worker starts; workers inherit it. */
export const RUN_ID_VARIABLE = 'TOKKL_E2E_RUN_ID';

function workerEmail(workerIndex: number): string {
  const runId = process.env[RUN_ID_VARIABLE];
  if (!runId) throw new Error(`${RUN_ID_VARIABLE} is not set; e2e/global-setup.ts sets it`);
  return `worker-${runId}-${workerIndex}@e2e.example`;
}

// Each Playwright worker is its own process; the worker-scoped `account` fixture sets this first.
let workerAccount: Account = ADMIN_ACCOUNT;

/** Its own invited user in the parallel project, or the setup admin in the instance project. */
export function currentAccount(): Account {
  return workerAccount;
}

export interface InstanceSettings {
  session_days: number;
  invite_days: number;
  time_resolution_minutes: number;
}

export interface NewUser {
  role?: 'admin' | 'user';
  /** A unique address, so leftovers from a failed run never collide. */
  email?: string;
  fullname?: string;
  timezone?: string;
}

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

const BASELINE_PREFERENCES = {
  manualMode: false,
  collapseTimeEntries: true,
  keyboard_shortcuts_enabled: true,
  favorites: [],
  timeofday_format: 'H:mm',
  timerView: 'list',
  theme: 'system',
  pomodoro_focus_interval_in_minutes: 25,
  pomodoro_break_interval_in_minutes: 5,
  pomodoro_long_break_interval_in_minutes: 15,
  pomodoro_long_break_every: 4,
  long_timer_reminder_enabled: true,
  long_timer_reminder_hours: 8,
};

interface SeedEntry {
  description: string;
  start: string;
  stop: string;
  project_id?: number;
}

interface Favorite {
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

async function ok(response: APIResponse): Promise<APIResponse> {
  if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response;
}

async function json<T>(response: Promise<APIResponse>): Promise<T> {
  return (await ok(await response)).json() as Promise<T>;
}

/**
 * Its own session, separate from the page's, so a scenario still logs in through the UI. Each scenario starts
 * and ends with an empty account; the instance project also resets the server to the setup admin.
 */
export class TestData {
  private readonly api: APIRequestContext;
  private readonly baseURL: string;
  readonly userId: number;
  readonly workspaceId: number;
  readonly account: Account;

  private constructor(
    api: APIRequestContext,
    baseURL: string,
    me: { id: number; default_workspace_id: number },
    account: Account,
  ) {
    this.api = api;
    this.baseURL = baseURL;
    this.userId = me.id;
    this.workspaceId = me.default_workspace_id;
    this.account = account;
  }

  private static async signedIn(api: APIRequestContext, baseURL: string, account: Account): Promise<TestData> {
    const me = await json<{ id: number; default_workspace_id: number }>(api.get('/api/v9/me'));
    return new TestData(api, baseURL, me, account);
  }

  static async open(baseURL: string): Promise<TestData> {
    const api = await request.newContext({ baseURL });
    const status = await json<{ setup_required: boolean }>(api.get('/api/app/status'));
    if (status.setup_required) {
      await ok(
        await api.post('/api/app/setup', {
          headers: CSRF,
          data: { setup_code: SETUP_CODE, ...ADMIN_ACCOUNT, timezone: 'Europe/Madrid' },
        }),
      );
    } else {
      await ok(await api.post('/api/app/login', { headers: CSRF, data: { email: EMAIL, password: PASSWORD } }));
    }
    return TestData.signedIn(api, baseURL, ADMIN_ACCOUNT);
  }

  static async login(baseURL: string, account: Account): Promise<TestData> {
    const api = await request.newContext({ baseURL });
    try {
      await ok(
        await api.post('/api/app/login', { headers: CSRF, data: { email: account.email, password: account.password } }),
      );
      return await TestData.signedIn(api, baseURL, account);
    } catch (error) {
      await api.dispose();
      throw error;
    }
  }

  /** This account, an admin, creates an invite and the new account accepts it, with a fresh workspace. */
  async inviteUser(options: NewUser = {}): Promise<TestData> {
    const { url } = await json<{ url: string }>(
      this.api.post('/api/app/admin/invites', {
        headers: CSRF,
        data: { role: options.role ?? 'user' },
      }),
    );
    const email = options.email ?? `user-${randomUUID().slice(0, 8)}@e2e.example`;
    const account: Account = { email, password: `${email} password`, fullname: options.fullname ?? 'Extra User' };
    const api = await request.newContext({ baseURL: this.baseURL });
    try {
      await ok(
        await api.post(url.replace(/^\/invite\//, '/api/app/invites/'), {
          headers: CSRF,
          data: { ...account, timezone: options.timezone ?? 'Europe/Madrid' },
        }),
      );
      return await TestData.signedIn(api, this.baseURL, account);
    } catch (error) {
      await api.dispose();
      throw error;
    }
  }

  async me(): Promise<{ role: 'admin' | 'user'; time_resolution_minutes: number }> {
    return json(this.api.get('/api/v9/me'));
  }

  async listUsers(): Promise<Array<{ id: number; email: string; role: 'admin' | 'user'; disabled_at: string | null }>> {
    return json(this.api.get('/api/app/admin/users'));
  }

  async instanceSettings(): Promise<InstanceSettings> {
    return json(this.api.get('/api/app/admin/settings'));
  }

  async saveInstanceSettings(settings: Partial<InstanceSettings>): Promise<void> {
    await ok(await this.api.put('/api/app/admin/settings', { headers: CSRF, data: settings }));
  }

  async createInvite(invite: { role: 'admin' | 'user'; note?: string }): Promise<number> {
    return (await json<{ id: number }>(this.api.post('/api/app/admin/invites', { headers: CSRF, data: invite }))).id;
  }

  async deleteUser(user: { id: number; email: string }): Promise<void> {
    await ok(await this.api.delete(`/api/app/admin/users/${user.id}`, { headers: CSRF, data: { email: user.email } }));
  }

  async deleteUsers(users: ReadonlyArray<{ userId: number; account: Account }>): Promise<void> {
    const remaining = new Set((await this.listUsers()).map(user => user.id));
    for (const user of users) {
      if (remaining.has(user.userId)) await this.deleteUser({ id: user.userId, email: user.account.email });
    }
  }

  /** Only global setup calls it, before any worker starts. */
  async deleteWorkerAccounts(): Promise<void> {
    for (const user of await this.listUsers()) {
      if (WORKER_EMAIL.test(user.email)) await this.deleteUser(user);
    }
  }

  async inviteList(): Promise<Array<{ id: number; role: 'admin' | 'user'; note: string | null }>> {
    return json(this.api.get('/api/app/admin/invites'));
  }

  async revokeInvites(): Promise<void> {
    for (const invite of await this.inviteList()) {
      await ok(await this.api.delete(`/api/app/admin/invites/${invite.id}`, { headers: CSRF }));
    }
  }

  /** Password reset links of the deleted accounts go with them. */
  async resetInstance(): Promise<void> {
    for (const user of await this.listUsers()) {
      if (user.id !== this.userId) await this.deleteUser(user);
    }
    await this.revokeInvites();
  }

  async entries(): Promise<Array<{ id: number; description: string }>> {
    return json(this.api.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
  }

  async projects(): Promise<Array<{ id: number; name: string }>> {
    return json(this.api.get(`/api/v9/workspaces/${this.workspaceId}/projects?active=both`));
  }

  /** Live writes refuse zero-length spans, so this goes through the Toggl CSV import, in Europe/Madrid wall time. */
  async createZeroLengthEntry(description: string, at: string): Promise<void> {
    const { day, time } = madridWallClock(new Date(at));
    const csv = `Description,Start date,Start time,End date,End time\n${description},${day},${time}:00,${day},${time}:00\n`;
    const result = await json<{ created: number }>(
      this.api.post('/api/app/import/toggl-csv', {
        headers: { ...CSRF, 'Content-Type': 'text/csv' },
        data: csv,
      }),
    );
    expect(result.created).toBe(1);
  }

  async createEntry(entry: SeedEntry): Promise<{ id: number }> {
    return json(
      this.api.post(`/api/v9/workspaces/${this.workspaceId}/time_entries`, {
        headers: CSRF,
        data: { ...entry, created_with: 'e2e' },
      }),
    );
  }

  async createNoTimeEntry(entry: { description: string; day: string; duration: number }): Promise<{ id: number }> {
    return json(
      this.api.post(`/api/v9/workspaces/${this.workspaceId}/time_entries`, {
        headers: CSRF,
        data: {
          description: entry.description,
          all_day: true,
          start_date: entry.day,
          duration: entry.duration,
          created_with: 'e2e',
        },
      }),
    );
  }

  async createClient(name: string): Promise<{ id: number }> {
    return json(this.api.post(`/api/v9/workspaces/${this.workspaceId}/clients`, { headers: CSRF, data: { name } }));
  }

  async createProject(project: { name: string; client_id?: number }): Promise<{ id: number }> {
    return json(this.api.post(`/api/v9/workspaces/${this.workspaceId}/projects`, { headers: CSRF, data: project }));
  }

  /** The fixture puts every key in BASELINE_PREFERENCES back after the test. */
  async savePreferences(preferences: {
    timeofday_format?: string;
    favorites?: Favorite[];
    theme?: 'system' | 'light' | 'dark';
  }): Promise<void> {
    await ok(await this.api.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
  }

  /** Touches only this account and its own workspace. */
  async reset(): Promise<void> {
    const ws = `/api/v9/workspaces/${this.workspaceId}`;
    for (const entry of await this.entries())
      await ok(await this.api.delete(`${ws}/time_entries/${entry.id}`, { headers: CSRF }));
    await ok(await this.api.delete('/api/app/trash', { headers: CSRF }));
    // A paused chain outlives its entries, because the server keeps it until nothing else runs it.
    const timer = await json<{ revision: number; pause: { paused: boolean } | null }>(this.api.get('/api/app/timer'));
    if (timer.pause?.paused)
      await ok(await this.api.post('/api/app/timer/discard', { headers: CSRF, data: { revision: timer.revision } }));
    for (const project of await this.projects()) {
      await ok(await this.api.delete(`${ws}/projects/${project.id}`, { headers: CSRF }));
    }
    for (const client of await json<Array<{ id: number }>>(this.api.get(`${ws}/clients?status=both`))) {
      await ok(await this.api.delete(`${ws}/clients/${client.id}`, { headers: CSRF }));
    }
    for (const tag of await json<Array<{ id: number }>>(this.api.get(`${ws}/tags`))) {
      await ok(await this.api.delete(`${ws}/tags/${tag.id}`, { headers: CSRF }));
    }
    await ok(await this.api.post('/api/v9/me/preferences', { headers: CSRF, data: BASELINE_PREFERENCES }));
  }

  async close(): Promise<void> {
    await this.api.post('/api/app/logout', { headers: CSRF });
    await this.api.dispose();
  }
}

/**
 * The app rereads the timer when its stream ends, so a page left on the app would see a failed request.
 * Call it before a fixture ends sessions or stops the server.
 */
export async function leavePages(context: BrowserContext): Promise<void> {
  await Promise.all(
    context.pages().map(page => {
      const url = page.url();
      return url.startsWith('http') && new URL(url).pathname !== '/healthz'
        ? page.goto(new URL('/healthz', url).href).catch(() => {})
        : undefined;
    }),
  );
}

/** Their sessions are closed and the accounts deleted when the scenario ends, so workers never collide. */
export class ExtraUsers {
  private readonly admin: TestData;
  private readonly created: TestData[] = [];

  constructor(admin: TestData) {
    this.admin = admin;
  }

  async create(options: NewUser = {}): Promise<TestData> {
    const user = await this.admin.inviteUser(options);
    this.created.push(user);
    return user;
  }

  async dispose(): Promise<void> {
    const users = this.created.splice(0);
    try {
      for (const user of users) await user.close();
    } finally {
      await this.admin.deleteUsers(users);
    }
  }
}

interface WorkerFixtures {
  /** The instance project's specs sign in as the setup admin and may change instance settings. */
  instanceWide: boolean;
  account: Account;
}

export const test = base.extend<{ data: TestData; users: ExtraUsers; runtimeErrors: RuntimeErrors }, WorkerFixtures>({
  instanceWide: [false, { scope: 'worker', option: true }],
  // A worker restarted after a failure gets a new workerIndex, so a new account.
  account: [
    async ({ instanceWide }, use, workerInfo) => {
      if (instanceWide) {
        workerAccount = ADMIN_ACCOUNT;
        await use(ADMIN_ACCOUNT);
        return;
      }
      const baseURL = workerInfo.project.use.baseURL!;
      const setupAdmin = await TestData.open(baseURL);
      try {
        const user = await setupAdmin.inviteUser({
          role: 'admin',
          email: workerEmail(workerInfo.workerIndex),
          fullname: 'E2E User',
        });
        await user.close();
        workerAccount = user.account;
        try {
          await use(user.account);
        } finally {
          await setupAdmin.deleteUsers([user]);
        }
      } finally {
        await setupAdmin.close();
      }
    },
    { scope: 'worker', auto: true },
  ],
  // Automatic. In the instance project it also deletes other accounts and pending invites left by a failure.
  data: [
    async ({ baseURL, account, instanceWide }, use) => {
      const data = instanceWide ? await TestData.open(baseURL!) : await TestData.login(baseURL!, account);
      const resetAll = async () => {
        if (instanceWide) await data.resetInstance();
        await data.reset();
      };
      try {
        await resetAll();
        await use(data);
      } finally {
        try {
          await resetAll();
        } finally {
          await data.close();
        }
      }
    },
    { auto: true },
  ],
  users: async ({ data, context }, use) => {
    const users = new ExtraUsers(data);
    try {
      await use(users);
    } finally {
      await leavePages(context);
      await users.dispose();
    }
  },
  // Fails on an uncaught error, console error or failed request; see e2e/runtime-errors.ts.
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors = new RuntimeErrors(page);
      await use(errors);
      await errors.verify(testInfo);
    },
    { auto: true },
  ],
});

export { expect };
