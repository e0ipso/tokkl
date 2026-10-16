import { expect, type APIResponse, type Locator, type Page } from '@playwright/test';

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

export interface Entry {
  id: number;
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
  start: string;
  stop: string | null;
  duration: number;
}

export interface Project {
  id: number;
  name: string;
  client_id: number | null;
  active: boolean;
  billable: boolean;
  rate: number | null;
  currency: string | null;
  estimated_hours: number | null;
  color: string;
}

export interface Task {
  id: number;
  name: string;
  project_id: number;
  active: boolean;
}

export interface EntrySeed {
  description: string;
  start: string;
  stop: string;
  project_id?: number;
  task_id?: number;
  tags?: string[];
  billable?: boolean;
}

async function body<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

/**
 * Reads and seeds data through the page's own session, so call it after logging in through the
 * UI. Requests sent with page.request do not reach the page's response listeners.
 */
export class EntityApi {
  private readonly page: Page;
  readonly workspaceId: number;

  private constructor(page: Page, workspaceId: number) {
    this.page = page;
    this.workspaceId = workspaceId;
  }

  static async open(page: Page): Promise<EntityApi> {
    const me = await body<{ default_workspace_id: number }>(await page.request.get('/api/v9/me'));
    return new EntityApi(page, me.default_workspace_id);
  }

  private ws(path: string): string {
    return `/api/v9/workspaces/${this.workspaceId}${path}`;
  }

  async createClient(name: string): Promise<{ id: number }> {
    return body(await this.page.request.post(this.ws('/clients'), { headers: CSRF, data: { name } }));
  }

  /** Archives the client and its projects. */
  async archiveClient(id: number): Promise<void> {
    await body(await this.page.request.post(this.ws(`/clients/${id}/archive`), { headers: CSRF }));
  }

  async createProject(project: { name: string; client_id?: number; billable?: boolean; active?: boolean }): Promise<Project> {
    return body(await this.page.request.post(this.ws('/projects'), { headers: CSRF, data: project }));
  }

  /** Archives the project. Its tasks stay, and the API still lets them be deleted. */
  async archiveProject(id: number): Promise<Project> {
    return body(await this.page.request.put(this.ws(`/projects/${id}`), { headers: CSRF, data: { active: false } }));
  }

  async createTask(projectId: number, name: string): Promise<Task> {
    return body(await this.page.request.post(this.ws(`/projects/${projectId}/tasks`), { headers: CSRF, data: { name } }));
  }

  async createTag(name: string): Promise<{ id: number; name: string }> {
    return body(await this.page.request.post(this.ws('/tags'), { headers: CSRF, data: { name } }));
  }

  async createEntry(entry: EntrySeed): Promise<Entry> {
    return body(await this.page.request.post(this.ws('/time_entries'), { headers: CSRF, data: { ...entry, created_with: 'e2e' } }));
  }

  async entry(id: number): Promise<Entry> {
    return body(await this.page.request.get(`/api/v9/me/time_entries/${id}`));
  }

  /** Live entries only; deleted ones are in `trash()`. */
  async entries(): Promise<Entry[]> {
    return body(await this.page.request.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
  }

  async trash(): Promise<Entry[]> {
    return body(await this.page.request.get('/api/app/trash'));
  }

  async project(id: number): Promise<Project> {
    return body(await this.page.request.get(this.ws(`/projects/${id}`)));
  }

  async projects(): Promise<Project[]> {
    return body(await this.page.request.get(this.ws('/projects?active=both')));
  }

  async client(id: number): Promise<{ id: number; name: string; notes: string | null; archived: boolean }> {
    return body(await this.page.request.get(this.ws(`/clients/${id}`)));
  }

  async clients(): Promise<Array<{ id: number; name: string; notes: string | null; archived: boolean }>> {
    return body(await this.page.request.get(this.ws('/clients?status=both')));
  }

  async tasks(projectId: number): Promise<Task[]> {
    return body(await this.page.request.get(this.ws(`/projects/${projectId}/tasks`)));
  }

  async tags(): Promise<Array<{ id: number; name: string }>> {
    return body(await this.page.request.get(this.ws('/tags')));
  }
}

/** Yesterday's UTC date, so seeded entries show in the timer list without crossing midnight in Europe/Madrid. */
export function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/** The timer list row for the entry with this description. */
export function entryRow(page: Page, description: string): Locator {
  return page.locator('.entry-line', { has: page.locator(`input[value="${description}"]`) });
}

/** Counts the page's requests that match `method` and `path`, for "saved once" checks. */
export function countRequests(page: Page, method: string, path: RegExp): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) count++;
  });
  return () => count;
}

/** Opens a row's menu on a manage page and picks an item. */
export async function rowAction(page: Page, name: string, action: string): Promise<void> {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** The "More actions" button of the row named `name`. */
export function rowMenu(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `More actions for ${name}`, exact: true });
}

/** Opens the row menu of `name` and picks `action`, by keyboard only. */
export async function rowActionByKeyboard(page: Page, name: string, action: string): Promise<void> {
  await rowMenu(page, name).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: action, exact: true }).focus();
  await page.keyboard.press('Enter');
}

/** Names of the projects the timer's project picker offers, then closes it. */
export async function timerPickerProjects(page: Page): Promise<string[]> {
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Project' }).click();
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Find or create project…') });
  await expect(picker).toBeVisible();
  const names = await picker.locator('.picker-item:not(.picker-subitem):not(.picker-create)').allTextContents();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  return names.map((name) => name.trim());
}

/**
 * Marks the loaded document. With `expectSameDocument` after in-app navigation, it proves the app
 * kept its query cache, so a refreshed view came from invalidation and not from a full reload.
 */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { entityTestsMark?: boolean }).entityTestsMark = true; });
}

export async function expectSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { entityTestsMark?: boolean }).entityTestsMark)).toBe(true);
}
