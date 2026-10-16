import { test as base, expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';

export const EMAIL = 'e2e@example.com';
export const PASSWORD = 'e2e password';
export const SETUP_CODE = 'E2E-SETUP-CODE';

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
};

interface SeedEntry {
  description: string;
  start: string;
  stop: string;
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
 * scenario still logs in through the UI. Every scenario starts and ends with an empty account.
 */
export class TestData {
  private readonly api: APIRequestContext;
  readonly workspaceId: number;

  private constructor(api: APIRequestContext, workspaceId: number) {
    this.api = api;
    this.workspaceId = workspaceId;
  }

  static async open(baseURL: string): Promise<TestData> {
    const api = await request.newContext({ baseURL });
    const status = await json<{ setup_required: boolean }>(api.get('/api/app/status'));
    if (status.setup_required) {
      await ok(await api.post('/api/app/setup', {
        headers: CSRF,
        data: { setup_code: SETUP_CODE, email: EMAIL, password: PASSWORD, fullname: 'E2E User', timezone: 'Europe/Madrid' },
      }));
    } else {
      await ok(await api.post('/api/app/login', { headers: CSRF, data: { email: EMAIL, password: PASSWORD } }));
    }
    const me = await json<{ default_workspace_id: number }>(api.get('/api/v9/me'));
    return new TestData(api, me.default_workspace_id);
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
  async savePreferences(preferences: { timeofday_format?: string; favorites?: Favorite[] }): Promise<void> {
    await ok(await this.api.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
  }

  /** Deletes every entry (running or not), the trash, projects, clients and tags, and resets preferences. */
  async reset(): Promise<void> {
    const ws = `/api/v9/workspaces/${this.workspaceId}`;
    const entries = await json<Array<{ id: number }>>(this.api.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
    for (const entry of entries) await ok(await this.api.delete(`${ws}/time_entries/${entry.id}`, { headers: CSRF }));
    await ok(await this.api.delete('/api/app/trash', { headers: CSRF }));
    for (const project of await json<Array<{ id: number }>>(this.api.get(`${ws}/projects?active=both`))) {
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

export const test = base.extend<{ data: TestData; runtimeErrors: RuntimeErrors }>({
  data: [async ({ baseURL }, use) => {
    const data = await TestData.open(baseURL!);
    await data.reset();
    await use(data);
    await data.reset();
    await data.close();
  }, { auto: true }],
  // Fails any scenario that hits an uncaught error, a console error or a failed request; see
  // e2e/runtime-errors.ts for the logged-out 403 rule and runtimeErrors.allowResponse.
  runtimeErrors: [async ({ page }, use, testInfo) => {
    const errors = new RuntimeErrors(page);
    await use(errors);
    await errors.verify(testInfo);
  }, { auto: true }],
});

export { expect };
