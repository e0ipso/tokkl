import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** The account timezone e2e/fixtures.ts gives the test account; CSV times are read in it. */
export const ACCOUNT_TIME_ZONE = 'Europe/Madrid';

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Reads a file from e2e/fixtures-data/transfer. `{{KEY}}` placeholders are replaced, so a fixture
 * can hold a row dated near today that the timer page lists.
 */
export function transferFixture(name: string, replacements: Record<string, string> = {}): UploadFile {
  let text = readFileSync(new URL(`./fixtures-data/transfer/${name}`, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(`{{${key}}}`, value);
  const mimeType = name.endsWith('.json') ? 'application/json' : 'text/csv';
  return { name, mimeType, buffer: Buffer.from(text) };
}

/** Yesterday's date (YYYY-MM-DD) in the account timezone; the timer page lists the last 14 days. */
export function recentDate(): string {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: ACCOUNT_TIME_ZONE }).format(yesterday);
}

/** The instant of a wall-clock time in the account timezone, as the API serialises it. */
export function accountTime(date: string, time: string): string {
  // Try both offsets the account timezone uses and keep the one that maps back to the wall clock.
  for (const offset of ['+01:00', '+02:00']) {
    const instant = new Date(`${date}T${time}${offset}`);
    const wall = new Intl.DateTimeFormat('sv-SE', {
      timeZone: ACCOUNT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(instant);
    if (wall === `${date} ${time}`) return `${instant.toISOString().slice(0, 19)}+00:00`;
  }
  throw new Error(`${date} ${time} does not exist in ${ACCOUNT_TIME_ZONE}`);
}

export interface Entry {
  id: number;
  description: string;
  start: string;
  stop: string | null;
  all_day: boolean;
  billable: boolean;
  project_id: number | null;
  project_name: string | null;
  client_name: string | null;
  task_id: number | null;
  task_name: string | null;
  tags: string[];
}

export interface Project {
  id: number;
  name: string;
  client_id: number | null;
  client_name: string | null;
  color: string;
  active: boolean;
  is_private: boolean;
  billable: boolean;
  rate: number | null;
  currency: string | null;
  estimated_hours: number | null;
  start_date: string;
  end_date: string | null;
  status: string;
  actual_seconds: number;
}

export interface Client {
  id: number;
  name: string;
  notes: string | null;
  archived: boolean;
}

export interface Task {
  id: number;
  name: string;
  project_id: number;
  project_name: string;
  active: boolean;
  estimated_seconds: number | null;
}

export interface Account {
  entries: Entry[];
  projects: Project[];
  clients: Client[];
  tags: string[];
  tasks: Task[];
}

/** Everything the test account holds, read through the page's own session. */
export async function readAccount(page: Page, workspaceId: number): Promise<Account> {
  const get = async <T>(path: string): Promise<T> => {
    const response = await page.request.get(path);
    expect(response.ok(), `GET ${path} answered ${response.status()}`).toBe(true);
    return response.json() as Promise<T>;
  };
  const ws = `/api/v9/workspaces/${workspaceId}`;
  const byName = <T extends { name: string }>(rows: T[]) => rows.sort((a, b) => a.name.localeCompare(b.name));
  const entries = await get<Entry[]>('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01&meta=true');
  return {
    entries: entries.sort((a, b) => a.start.localeCompare(b.start)),
    projects: byName(await get<Project[]>(`${ws}/projects?active=both`)),
    clients: byName(await get<Client[]>(`${ws}/clients?status=both`)),
    tags: (await get<Array<{ name: string }>>(`${ws}/tags`)).map((tag) => tag.name).sort(),
    tasks: byName(await get<Task[]>('/api/v9/me/tasks?include_not_active=true')),
  };
}

/** Asserts that the account holds no entries, projects, clients, tags or tasks. */
export async function expectEmptyAccount(page: Page, workspaceId: number): Promise<void> {
  const account = await readAccount(page, workspaceId);
  expect({
    entries: account.entries.length, projects: account.projects.length, clients: account.clients.length,
    tags: account.tags.length, tasks: account.tasks.length,
  }).toEqual({ entries: 0, projects: 0, clients: 0, tags: 0, tasks: 0 });
}

/** Opens Settings through the app's own navigation, so cached queries survive. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible();
}

export async function chooseCsv(page: Page, file: UploadFile): Promise<void> {
  await page.locator('input[type=file][accept*="csv"]').setInputFiles(file);
}

export async function chooseJson(page: Page, file: UploadFile): Promise<void> {
  await page.locator('input[type=file][accept*="json"]').setInputFiles(file);
}
