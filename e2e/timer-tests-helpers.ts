import { expect, type APIResponse, type Page } from '@playwright/test';

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

export interface EntryView {
  id: number;
  description: string;
  start: string;
  stop: string | null;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

/** The metadata Continue, favorites and autocomplete promise to copy. */
export type Metadata = Pick<EntryView, 'description' | 'project_id' | 'task_id' | 'tags' | 'billable'>;

async function ok<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

/**
 * Reads and seeds data through the page's own session, so call it after logging in. The automatic
 * fixture in e2e/fixtures.ts deletes everything created here, tasks included with their projects.
 */
export class TimerApi {
  private readonly page: Page;
  readonly workspaceId: number;

  private constructor(page: Page, workspaceId: number) {
    this.page = page;
    this.workspaceId = workspaceId;
  }

  static async open(page: Page): Promise<TimerApi> {
    const me = await ok<{ default_workspace_id: number }>(await page.request.get('/api/v9/me'));
    return new TimerApi(page, me.default_workspace_id);
  }

  private get ws(): string {
    return `/api/v9/workspaces/${this.workspaceId}`;
  }

  async createProject(name: string, billable = false): Promise<number> {
    return (await ok<{ id: number }>(await this.page.request.post(`${this.ws}/projects`, { headers: CSRF, data: { name, billable } }))).id;
  }

  async createTask(projectId: number, name: string): Promise<number> {
    return (await ok<{ id: number }>(await this.page.request.post(`${this.ws}/projects/${projectId}/tasks`, { headers: CSRF, data: { name } }))).id;
  }

  async createEntry(entry: Partial<Metadata> & { start: string; stop: string }): Promise<EntryView> {
    return view(await ok(await this.page.request.post(`${this.ws}/time_entries`, { headers: CSRF, data: { ...entry, created_with: 'e2e' } })));
  }

  /** Seeds a running entry, as another device that started a timer at `start` would. */
  async startTimer(entry: Partial<Metadata> & { start: string }): Promise<EntryView> {
    return view(await ok(await this.page.request.post(`${this.ws}/time_entries`, { headers: CSRF, data: { ...entry, duration: -1, created_with: 'e2e' } })));
  }

  async current(): Promise<EntryView | null> {
    const entry = await ok<EntryView | null>(await this.page.request.get('/api/v9/me/time_entries/current'));
    return entry ? view(entry) : null;
  }

  async entries(): Promise<EntryView[]> {
    const all = await ok<EntryView[]>(await this.page.request.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'));
    return all.map(view);
  }

  async preferences(): Promise<Record<string, unknown>> {
    return ok(await this.page.request.get('/api/v9/me/preferences'));
  }

  async savePreferences(preferences: Record<string, unknown>): Promise<void> {
    await ok(await this.page.request.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
  }
}

/** Keeps the compared fields only, with tags sorted so their order never matters. */
export function view(entry: EntryView): EntryView {
  const { id, description, start, stop, project_id, task_id, billable } = entry;
  return { id, description, start, stop, project_id, task_id, tags: [...(entry.tags ?? [])].sort(), billable };
}

export function metadataOf(entry: Metadata): Metadata {
  const { description, project_id, task_id, billable } = entry;
  return { description, project_id, task_id, tags: [...entry.tags].sort(), billable };
}

/** Waits until a running entry other than `previousId` exists and returns it. */
export async function nextRunning(api: TimerApi, previousId: number | null): Promise<EntryView> {
  let running: EntryView | null = null;
  await expect.poll(async () => {
    running = await api.current();
    return running !== null && running.id !== previousId;
  }).toBe(true);
  return running!;
}

/** Date key (YYYY-MM-DD) and 24-hour clock text of an instant in Europe/Madrid, the e2e account zone. */
export function madridWallClock(at: Date): { day: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** API timestamps carry "+00:00"; compare instants, not strings. */
export function instant(iso: string | null): number {
  expect(iso).not.toBeNull();
  return Date.parse(iso!);
}

/**
 * Expects `saved`, a stopped entry that ran from `exactStart`, to sit on the time resolution grid of
 * `step` milliseconds: its start is the grid point nearest `exactStart` and its duration is a
 * multiple of the step. Europe/Madrid is a whole number of hours off UTC, so its grid is the UTC one.
 */
export function expectSnapped(saved: Pick<EntryView, 'start' | 'stop'>, exactStart: string, step: number): void {
  const start = instant(saved.start);
  expect(start % step).toBe(0);
  expect(Math.abs(start - instant(exactStart))).toBeLessThanOrEqual(step / 2);
  expect((instant(saved.stop) - start) % step).toBe(0);
}

const STOP_REQUEST = /\/time_entries\/\d+\/stop(?:\?|$)/;

/**
 * Holds the answer to the next stop request, as a slow network would: the server stops the entry
 * at once, and the page sees the response only after `release()`. Later stop requests pass straight
 * through. Requests matching `alsoHold`, such as a current-entry poll, wait for `release()` before
 * they reach the server. `stops.count` counts every stop request; `sent` resolves on the first one.
 */
export async function holdNextStop(
  page: Page,
  alsoHold?: RegExp,
): Promise<{ sent: Promise<unknown>; release: () => void; stops: { count: number } }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const stops = { count: 0 };
  if (alsoHold) {
    await page.route(alsoHold, async (route) => {
      await gate;
      await route.continue();
    });
  }
  await page.route(STOP_REQUEST, async (route) => {
    stops.count += 1;
    if (stops.count > 1) return route.continue();
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  const sent = page.waitForRequest((request) => request.method() === 'PATCH' && STOP_REQUEST.test(request.url()));
  return { sent, release, stops };
}
