import { randomUUID } from 'node:crypto';
import { test as base, expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';

export const EMAIL = 'e2e@example.com';
export const PASSWORD = 'e2e password';
export const SETUP_CODE = 'E2E-SETUP-CODE';

/** What the login form needs for one account. */
export interface Account {
  email: string;
  password: string;
  fullname: string;
}

/** The setup account: the only admin of the e2e server, and the account `data` signs in as. */
export const ADMIN_ACCOUNT: Account = { email: EMAIL, password: PASSWORD, fullname: 'E2E User' };

export interface InstanceSettings {
  session_days: number;
  invite_days: number;
}

export interface NewUser {
  role?: 'admin' | 'user';
  /** Defaults to a unique address, so leftovers from a failed run never collide. */
  email?: string;
  fullname?: string;
}

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

// Preferences that scenarios change, set back to the defaults a new account gets.
const BASELINE_PREFERENCES = {
  manualMode: false,
  collapseTimeEntries: true,
  keyboard_shortcuts_enabled: true,
  favorites: [],
  timeofday_format: 'H:mm',
  timerView: 'list',
  theme: 'system',
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
 * Talks to the disposable test server with its own session, separate from the page's, so a
 * scenario still logs in through the UI. Every scenario starts and ends with an empty account and
 * with the setup admin as the only account. The `data` fixture signs in as the setup admin;
 * `users.create()` adds other accounts.
 */
export class TestData {
  private readonly api: APIRequestContext;
  private readonly baseURL: string;
  readonly userId: number;
  readonly workspaceId: number;
  readonly account: Account;

  private constructor(api: APIRequestContext, baseURL: string, me: { id: number; default_workspace_id: number }, account: Account) {
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
      await ok(await api.post('/api/app/setup', {
        headers: CSRF,
        data: { setup_code: SETUP_CODE, ...ADMIN_ACCOUNT, timezone: 'Europe/Madrid' },
      }));
    } else {
      await ok(await api.post('/api/app/login', { headers: CSRF, data: { email: EMAIL, password: PASSWORD } }));
    }
    return TestData.signedIn(api, baseURL, ADMIN_ACCOUNT);
  }

  /**
   * Creates another account the way a person joins: this account, which must be an admin, creates
   * an invite and the new account accepts it. The new account owns a fresh workspace.
   */
  async inviteUser(options: NewUser = {}): Promise<TestData> {
    const { url } = await json<{ url: string }>(this.api.post('/api/app/admin/invites', {
      headers: CSRF, data: { role: options.role ?? 'user' },
    }));
    const email = options.email ?? `user-${randomUUID().slice(0, 8)}@e2e.example`;
    const account: Account = { email, password: `${email} password`, fullname: options.fullname ?? 'Extra User' };
    const api = await request.newContext({ baseURL: this.baseURL });
    try {
      await ok(await api.post(url.replace(/^\/invite\//, '/api/app/invites/'), {
        headers: CSRF, data: { ...account, timezone: 'Europe/Madrid' },
      }));
      return await TestData.signedIn(api, this.baseURL, account);
    } catch (error) {
      await api.dispose();
      throw error;
    }
  }

  /** Every account on the server, as an admin sees them. */
  async listUsers(): Promise<Array<{ id: number; email: string; role: 'admin' | 'user'; disabled_at: string | null }>> {
    return json(this.api.get('/api/app/admin/users'));
  }

  /** The instance settings, as an admin sees them. */
  async instanceSettings(): Promise<InstanceSettings> {
    return json(this.api.get('/api/app/admin/settings'));
  }

  async saveInstanceSettings(settings: InstanceSettings): Promise<void> {
    await ok(await this.api.put('/api/app/admin/settings', { headers: CSRF, data: settings }));
  }

  /** Creates an invite as an admin, through the API, and returns its id. The link is not kept. */
  async createInvite(invite: { role: 'admin' | 'user'; note?: string }): Promise<number> {
    return (await json<{ id: number }>(this.api.post('/api/app/admin/invites', { headers: CSRF, data: invite }))).id;
  }

  /** Deletes another account and its workspace, as an admin. */
  async deleteUser(user: { id: number; email: string }): Promise<void> {
    await ok(await this.api.delete(`/api/app/admin/users/${user.id}`, { headers: CSRF, data: { email: user.email } }));
  }

  /** Pending invites, as an admin sees them. */
  async inviteList(): Promise<Array<{ id: number; role: 'admin' | 'user'; note: string | null }>> {
    return json(this.api.get('/api/app/admin/invites'));
  }

  /** Revokes every invite nobody has accepted yet, as an admin. */
  async revokeInvites(): Promise<void> {
    for (const invite of await this.inviteList()) {
      await ok(await this.api.delete(`/api/app/admin/invites/${invite.id}`, { headers: CSRF }));
    }
  }

  /**
   * Deletes every other account and revokes every pending invite, as an admin, so the server again
   * holds only this account. Password reset links of the deleted accounts go with them.
   */
  async resetInstance(): Promise<void> {
    for (const user of await this.listUsers()) {
      if (user.id !== this.userId) await this.deleteUser(user);
    }
    await this.revokeInvites();
  }

  /** Entries of this account, newest first. */
  async entries(): Promise<Array<{ id: number; description: string }>> {
    return json(this.api.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
  }

  /** Projects in this account's workspace, archived ones included. */
  async projects(): Promise<Array<{ id: number; name: string }>> {
    return json(this.api.get(`/api/v9/workspaces/${this.workspaceId}/projects?active=both`));
  }

  async createEntry(entry: SeedEntry): Promise<{ id: number }> {
    return json(this.api.post(`/api/v9/workspaces/${this.workspaceId}/time_entries`, {
      headers: CSRF,
      data: { ...entry, created_with: 'e2e' },
    }));
  }

  async createClient(name: string): Promise<{ id: number }> {
    return json(this.api.post(`/api/v9/workspaces/${this.workspaceId}/clients`, { headers: CSRF, data: { name } }));
  }

  async createProject(project: { name: string; client_id?: number }): Promise<{ id: number }> {
    return json(this.api.post(`/api/v9/workspaces/${this.workspaceId}/projects`, { headers: CSRF, data: project }));
  }

  /** Saves preferences; the fixture puts every key in BASELINE_PREFERENCES back after the test. */
  async savePreferences(preferences: { timeofday_format?: string; favorites?: Favorite[]; theme?: 'system' | 'light' | 'dark' }): Promise<void> {
    await ok(await this.api.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
  }

  /**
   * Deletes every entry (running or not), the trash, projects, clients and tags, and resets
   * preferences. It touches only this account and its own workspace, so other accounts keep theirs.
   */
  async reset(): Promise<void> {
    const ws = `/api/v9/workspaces/${this.workspaceId}`;
    for (const entry of await this.entries()) await ok(await this.api.delete(`${ws}/time_entries/${entry.id}`, { headers: CSRF }));
    await ok(await this.api.delete('/api/app/trash', { headers: CSRF }));
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
 * Extra accounts for one scenario, created through invites by the setup admin. When the scenario
 * ends their sessions are closed; the `data` fixture then deletes the accounts.
 */
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
    for (const user of this.created.splice(0)) await user.close();
  }
}

export const test = base.extend<{ data: TestData; users: ExtraUsers; runtimeErrors: RuntimeErrors }>({
  // Automatic, so a scenario that creates accounts or invites without the users fixture, and fails
  // before cleaning up, still leaves the server with the setup admin alone.
  data: [async ({ baseURL }, use) => {
    const data = await TestData.open(baseURL!);
    try {
      await data.resetInstance();
      await data.reset();
      await use(data);
    } finally {
      try {
        await data.resetInstance();
        await data.reset();
      } finally {
        await data.close();
      }
    }
  }, { auto: true }],
  users: async ({ data }, use) => {
    const users = new ExtraUsers(data);
    try {
      await use(users);
    } finally {
      await users.dispose();
    }
  },
  // Fails any scenario that hits an uncaught error, a console error or a failed request; see
  // e2e/runtime-errors.ts for the logged-out 403 rule and runtimeErrors.allowResponse.
  runtimeErrors: [async ({ page }, use, testInfo) => {
    const errors = new RuntimeErrors(page);
    await use(errors);
    await errors.verify(testInfo);
  }, { auto: true }],
});

export { expect };
