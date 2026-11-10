import { expect, type APIResponse, type Browser, type Page } from '@playwright/test';
import { RuntimeErrors } from './runtime-errors.ts';

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

export type Metadata = Pick<EntryView, 'description' | 'project_id' | 'task_id' | 'tags' | 'billable'>;

async function ok<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

/** Uses the page's own session, so call it after logging in. The automatic fixture deletes what it creates. */
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
    return (
      await ok<{ id: number }>(
        await this.page.request.post(`${this.ws}/projects`, { headers: CSRF, data: { name, billable } }),
      )
    ).id;
  }

  async createTask(projectId: number, name: string): Promise<number> {
    return (
      await ok<{ id: number }>(
        await this.page.request.post(`${this.ws}/projects/${projectId}/tasks`, { headers: CSRF, data: { name } }),
      )
    ).id;
  }

  async createEntry(entry: Partial<Metadata> & { start: string; stop: string }): Promise<EntryView> {
    return view(
      await ok(
        await this.page.request.post(`${this.ws}/time_entries`, {
          headers: CSRF,
          data: { ...entry, created_with: 'e2e' },
        }),
      ),
    );
  }

  async startTimer(entry: Partial<Metadata> & { start: string }): Promise<EntryView> {
    return view(
      await ok(
        await this.page.request.post(`${this.ws}/time_entries`, {
          headers: CSRF,
          data: { ...entry, duration: -1, created_with: 'e2e' },
        }),
      ),
    );
  }

  /** A timer stopped seconds after it started rounds to zero and goes to the trash, so backdate first. */
  async backdate(id: number, minutes: number): Promise<EntryView> {
    const entry = await ok<EntryView>(await this.page.request.get(`/api/v9/me/time_entries/${id}`));
    const start = new Date(Date.parse(entry.start) - minutes * 60_000).toISOString();
    return view(
      await ok(await this.page.request.put(`${this.ws}/time_entries/${id}`, { headers: CSRF, data: { start } })),
    );
  }

  async trash(): Promise<EntryView[]> {
    return (await ok<EntryView[]>(await this.page.request.get('/api/app/trash'))).map(view);
  }

  async current(): Promise<EntryView | null> {
    const entry = await ok<EntryView | null>(await this.page.request.get('/api/v9/me/time_entries/current'));
    return entry ? view(entry) : null;
  }

  async entries(): Promise<EntryView[]> {
    const all = await ok<EntryView[]>(
      await this.page.request.get('/api/v9/me/time_entries?start_date=1970-01-01&end_date=2100-01-01'),
    );
    return all.map(view);
  }

  async preferences(): Promise<Record<string, unknown>> {
    return ok(await this.page.request.get('/api/v9/me/preferences'));
  }

  async savePreferences(preferences: Record<string, unknown>): Promise<void> {
    await ok(await this.page.request.post('/api/v9/me/preferences', { headers: CSRF, data: preferences }));
  }
}

/** Tags sorted so their order never matters. */
export function view(entry: EntryView): EntryView {
  const { id, description, start, stop, project_id, task_id, billable } = entry;
  return { id, description, start, stop, project_id, task_id, tags: [...(entry.tags ?? [])].sort(), billable };
}

export function metadataOf(entry: Metadata): Metadata {
  const { description, project_id, task_id, billable } = entry;
  return { description, project_id, task_id, tags: [...entry.tags].sort(), billable };
}

export async function nextRunning(api: TimerApi, previousId: number | null): Promise<EntryView> {
  let running: EntryView | null = null;
  await expect
    .poll(async () => {
      running = await api.current();
      return running !== null && running.id !== previousId;
    })
    .toBe(true);
  return running!;
}

/** In Europe/Madrid, the e2e account zone. */
export function madridWallClock(at: Date): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map(part => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** API timestamps carry "+00:00"; compare instants, not strings. */
export function instant(iso: string | null): number {
  expect(iso).not.toBeNull();
  return Date.parse(iso!);
}

/** Start on the grid point nearest `exactStart`, duration a multiple of `step`. Madrid's grid is the UTC one. */
export function expectSnapped(saved: Pick<EntryView, 'start' | 'stop'>, exactStart: string, step: number): void {
  const start = instant(saved.start);
  expect(start % step).toBe(0);
  expect(Math.abs(start - instant(exactStart))).toBeLessThanOrEqual(step / 2);
  expect((instant(saved.stop) - start) % step).toBe(0);
}

const STOP_REQUEST = /\/api\/app\/timer\/stop$/;

/** The server stops the entry at once; the page sees the reply after `release()`. `alsoHold` requests wait too. */
export async function holdNextStop(
  page: Page,
  alsoHold?: RegExp,
): Promise<{ sent: Promise<unknown>; release: () => void; stops: { count: number } }> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const stops = { count: 0 };
  if (alsoHold) {
    await page.route(alsoHold, async route => {
      await gate;
      await route.continue();
    });
  }
  await page.route(STOP_REQUEST, async route => {
    stops.count += 1;
    if (stops.count > 1) return route.continue();
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  const sent = page.waitForRequest(request => request.method() === 'POST' && STOP_REQUEST.test(request.url()));
  return { sent, release, stops };
}

declare global {
  interface Window {
    timerTraffic: number;
    timerStreams: EventSource[];
    fetchesInFlight: number;
  }
}

/**
 * The page takes its clock offset from the latest state, so a fake clock moved while a state is in flight snaps
 * back when it lands. `settleTimerTraffic` tells when none is.
 */
export async function watchTimerTraffic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.timerTraffic = 0;
    window.timerStreams = [];
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        window.timerStreams.push(this);
        this.addEventListener('timer', () => {
          window.timerTraffic++;
        });
      }
    };
    window.fetchesInFlight = 0;
    const nativeFetch = window.fetch;
    window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
      window.fetchesInFlight++;
      try {
        const response = await nativeFetch.apply(this, args);
        if (
          /^\/api\/app\/(timer|pomodoro)(\/(start|stop|pause|resume|discard|next|end))?$/.test(
            new URL(response.url).pathname,
          )
        )
          window.timerTraffic++;
        return response;
      } finally {
        window.fetchesInFlight--;
      }
    };
  });
}

const KEEP_ALIVE_MS = 25_000;

/**
 * Steps at most one keep-alive long, each with a keep-alive event, so the app keeps its stream, and each waits
 * for in-flight requests, since the fake clock drives `AbortSignal.timeout` too. Needs `watchTimerTraffic`.
 */
export async function fastForwardStreaming(page: Page, ms: number): Promise<void> {
  const pages = () => page.context().pages();
  for (let left = ms; left > 0; left -= KEEP_ALIVE_MS) {
    await expect
      .poll(
        async () => {
          const counts = await Promise.all(pages().map(open => open.evaluate(() => window.fetchesInFlight ?? 0)));
          return counts.reduce((sum, count) => sum + count, 0);
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    await page.clock.fastForward(Math.min(left, KEEP_ALIVE_MS));
    await Promise.all(
      page
        .context()
        .pages()
        .map(open =>
          open.evaluate(() => {
            for (const stream of window.timerStreams ?? []) {
              if (stream.readyState === EventSource.OPEN)
                stream.dispatchEvent(new MessageEvent('keep-alive', { data: '' }));
            }
          }),
        ),
    );
  }
}

/** Needs `watchTimerTraffic`. */
export async function settleTimerTraffic(page: Page): Promise<void> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const seen = await page.evaluate(() => window.timerTraffic);
        const quiet = seen === last;
        last = seen;
        return quiet;
      },
      { intervals: [300], timeout: 15_000 },
    )
    .toBe(true);
}

/** `prepare` runs on the new page before it opens `path`. Call `errors.verify(testInfo)` at the end. */
export async function openSecondDevice(
  page: Page,
  browser: Browser,
  { path = '/', prepare }: { path?: string; prepare?: (other: Page) => Promise<void> } = {},
): Promise<{ other: Page; errors: RuntimeErrors }> {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    timezoneId: 'Europe/Madrid',
  });
  const other = await context.newPage();
  const errors = new RuntimeErrors(other);
  await prepare?.(other);
  await other.goto(path);
  return { other, errors };
}

/** `sent` resolves when the page has issued it. */
export async function holdRequest(
  page: Page,
  path: RegExp,
  method = 'POST',
): Promise<{ sent: Promise<void>; release: () => void }> {
  const sent = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let held = false;
  await page.route(path, async route => {
    if (held || route.request().method() !== method) return route.continue();
    held = true;
    sent.resolve();
    await gate.promise;
    await route.continue();
  });
  return { sent: sent.promise, release: () => gate.resolve() };
}
