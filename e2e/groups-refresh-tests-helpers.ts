import { request, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { currentAccount } from './fixtures.ts';

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

export interface StoredEntry {
  id: number;
  description: string;
  project_id: number | null;
  tags: string[];
  billable: boolean;
  start: string;
  stop: string | null;
}

/** The fields a list edit can change, with tags in a stable order. */
export interface EntryState {
  description: string;
  project_id: number | null;
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
 * A second device on the same account: its own API session, separate from the page and from the
 * fixture's TestData. The automatic fixture still wipes everything it creates.
 */
export class OtherDevice {
  private readonly api: APIRequestContext;
  private readonly workspaceId: number;

  private constructor(api: APIRequestContext, workspaceId: number) {
    this.api = api;
    this.workspaceId = workspaceId;
  }

  static async open(baseURL: string): Promise<OtherDevice> {
    const api = await request.newContext({ baseURL });
    const { email, password } = currentAccount();
    await ok(await api.post('/api/app/login', { headers: CSRF, data: { email, password } }));
    const me = await json<{ default_workspace_id: number }>(api.get('/api/v9/me'));
    return new OtherDevice(api, me.default_workspace_id);
  }

  private get ws(): string {
    return `/api/v9/workspaces/${this.workspaceId}`;
  }

  async createEntry(entry: {
    description: string; start: string; stop?: string; project_id?: number; tags?: string[]; billable?: boolean;
  }): Promise<StoredEntry> {
    return json(this.api.post(`${this.ws}/time_entries`, { headers: CSRF, data: { ...entry, created_with: 'e2e other device' } }));
  }

  /**
   * Starts a running entry ten minutes ago, which stops any other running entry. A timer stopped
   * seconds after it started would round to zero at the time resolution and go to the trash.
   */
  async startTimer(description: string): Promise<StoredEntry> {
    return json(this.api.post(`${this.ws}/time_entries`, {
      headers: CSRF,
      data: { description, start: new Date(Date.now() - 10 * 60_000).toISOString(), duration: -1, created_with: 'e2e other device' },
    }));
  }

  async stopTimer(id: number): Promise<StoredEntry> {
    return json(this.api.patch(`${this.ws}/time_entries/${id}/stop`, { headers: CSRF }));
  }

  async updateEntry(id: number, changes: Partial<EntryState>): Promise<StoredEntry> {
    return json(this.api.put(`${this.ws}/time_entries/${id}`, { headers: CSRF, data: changes }));
  }

  async deleteEntry(id: number): Promise<void> {
    await ok(await this.api.delete(`${this.ws}/time_entries/${id}`, { headers: CSRF }));
  }

  async createProject(name: string): Promise<{ id: number; name: string }> {
    return json(this.api.post(`${this.ws}/projects`, { headers: CSRF, data: { name } }));
  }

  async createTag(name: string): Promise<{ id: number; name: string }> {
    return json(this.api.post(`${this.ws}/tags`, { headers: CSRF, data: { name } }));
  }

  /** Live (not deleted) entries by id. */
  async entries(): Promise<Map<number, StoredEntry>> {
    const list = await json<StoredEntry[]>(this.api.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
    return new Map(list.map((entry) => [entry.id, entry]));
  }

  /** Ids of entries in the trash. */
  async trashIds(): Promise<number[]> {
    const list = await json<Array<{ id: number }>>(this.api.get('/api/app/trash'));
    return list.map((entry) => entry.id).sort((a, b) => a - b);
  }

  /** The editable fields of every live entry, keyed by id, for comparing before and after an edit. */
  async states(): Promise<Record<number, EntryState>> {
    const states: Record<number, EntryState> = {};
    for (const [id, entry] of await this.entries()) states[id] = stateOf(entry);
    return states;
  }

  async close(): Promise<void> {
    await this.api.post('/api/app/logout', { headers: CSRF });
    await this.api.dispose();
  }
}

export function stateOf(entry: StoredEntry): EntryState {
  return { description: entry.description, project_id: entry.project_id, tags: [...entry.tags].sort(), billable: entry.billable };
}

/** `days` calendar days before today in UTC, as YYYY-MM-DD; 10:00-13:00 UTC stays on that day in Europe/Madrid. */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** The list row showing the entry whose description input holds `description`. */
export function entryRow(page: Page, description: string) {
  return page.locator('.entry-line', { has: page.locator(`input.entry-description[value="${description}"]`) });
}
/** Reports the page as hidden or visible and fires visibilitychange, as switching tabs or apps does. */
export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' });
    // The browser's event bubbles to window, where TanStack Query listens.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);
}

/** Counts the GET requests the page sends for the running timer and for the history list. */
export function countPolls(page: Page): { current: number; history: number } {
  const counts = { current: 0, history: 0 };
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const path = new URL(req.url()).pathname;
    if (path === '/api/v9/me/time_entries/current') counts.current++;
    else if (path === '/api/v9/me/time_entries') counts.history++;
  });
  return counts;
}
