import { readFile } from 'node:fs/promises';
import { request, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { screenshotExport } from '../scripts/screenshots-data.ts';
import { currentAccount, expect, test as base } from './fixtures.ts';

// Cookie-authenticated writes must carry this header (packages/api/src/auth/middleware.ts).
const CSRF = { 'X-Tokkl-CSRF': '1' };

/** Account and workspace settings the report specs change. The shared reset fixture leaves them alone. */
interface ReportSettings {
  beginning_of_week: number;
  rounding: number;
  rounding_minutes: number;
  default_hourly_rate: number | null;
  default_currency: string;
}

interface EntryInput {
  description: string;
  start: string;
  stop: string;
  project_id?: number;
  billable?: boolean;
  tags?: string[];
}

async function ok(response: APIResponse): Promise<APIResponse> {
  if (!response.ok()) throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** Seeds report data and changes report settings through the API, with its own session. */
export class ReportApi {
  private readonly api: APIRequestContext;
  readonly workspaceId: number;

  private constructor(api: APIRequestContext, workspaceId: number) {
    this.api = api;
    this.workspaceId = workspaceId;
  }

  static async open(baseURL: string): Promise<ReportApi> {
    const api = await request.newContext({ baseURL });
    const { email, password } = currentAccount();
    await ok(await api.post('/api/app/login', { headers: CSRF, data: { email, password } }));
    const me = await (await ok(await api.get('/api/v9/me'))).json() as { default_workspace_id: number };
    return new ReportApi(api, me.default_workspace_id);
  }

  private get ws(): string {
    return `/api/v9/workspaces/${this.workspaceId}`;
  }

  private async send<T>(method: 'post' | 'put', path: string, data: unknown): Promise<T> {
    return (await ok(await this.api[method](path, { headers: CSRF, data }))).json() as Promise<T>;
  }

  async settings(): Promise<ReportSettings> {
    const me = await (await ok(await this.api.get('/api/v9/me'))).json() as { beginning_of_week: number };
    const ws = await (await ok(await this.api.get(this.ws))).json() as Omit<ReportSettings, 'beginning_of_week'>;
    return {
      beginning_of_week: me.beginning_of_week,
      rounding: ws.rounding,
      rounding_minutes: ws.rounding_minutes,
      default_hourly_rate: ws.default_hourly_rate,
      default_currency: ws.default_currency,
    };
  }

  async restore(saved: ReportSettings): Promise<void> {
    const { beginning_of_week, ...workspace } = saved;
    await this.send('put', '/api/v9/me', { beginning_of_week });
    await this.send('put', this.ws, workspace);
  }

  async setWeekStart(day: number): Promise<void> {
    await this.send('put', '/api/v9/me', { beginning_of_week: day });
  }

  async setWorkspace(patch: Partial<Omit<ReportSettings, 'beginning_of_week'>>): Promise<void> {
    await this.send('put', this.ws, patch);
  }

  async client(name: string): Promise<number> {
    return (await this.send<{ id: number }>('post', `${this.ws}/clients`, { name })).id;
  }

  async project(project: { name: string; client_id?: number; billable?: boolean; rate?: number; currency?: string }): Promise<number> {
    return (await this.send<{ id: number }>('post', `${this.ws}/projects`, project)).id;
  }

  async entry(entry: EntryInput): Promise<number> {
    return (await this.send<{ id: number }>('post', `${this.ws}/time_entries`, { ...entry, created_with: 'e2e' })).id;
  }

  async tagId(name: string): Promise<number> {
    const tags = await (await ok(await this.api.get(`${this.ws}/tags`))).json() as Array<{ id: number; name: string }>;
    const tag = tags.find((candidate) => candidate.name === name);
    if (!tag) throw new Error(`No tag named ${name}`);
    return tag.id;
  }

  async getEntry(id: number): Promise<{ start: string; stop: string; duration: number }> {
    return (await ok(await this.api.get(`/api/v9/me/time_entries/${id}`))).json();
  }

  /** Restores a JSON export into this account, as Settings does, and returns what it could not import. */
  async importJson(document: unknown): Promise<{ errors: unknown[] }> {
    return this.send('post', '/api/app/import/json', document);
  }

  /** Posts without failing on an error status, for compatibility endpoints that refuse a request. */
  async rawPost(path: string, data: unknown): Promise<APIResponse> {
    return this.api.post(path, { headers: CSRF, data });
  }

  async close(): Promise<void> {
    await this.api.post('/api/app/logout', { headers: CSRF });
    await this.api.dispose();
  }
}

/** The shared fixtures plus `api`, which puts the report settings back after every scenario. */
export const test = base.extend<{ api: ReportApi }>({
  api: async ({ baseURL }, use) => {
    const api = await ReportApi.open(baseURL!);
    const saved = await api.settings();
    try {
      await use(api);
    } finally {
      await api.restore(saved);
      await api.close();
    }
  },
});

export { expect };

/** "H:MM:SS" as the default "improved" duration format shows it. */
export function hms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function toSeconds(text: string): number {
  const [h, m, s] = text.trim().split(':').map(Number) as [number, number, number];
  return h * 3600 + m * 60 + s;
}

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Clicks an export button and returns the downloaded file's name and parsed rows. */
export async function downloadCsv(page: Page, button: string): Promise<{ filename: string; rows: string[][] }> {
  const download = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Export' }).getByRole('button', { name: button }).click();
  const file = await download;
  return { filename: file.suggestedFilename(), rows: parseCsv(await readFile(await file.path(), 'utf8')) };
}

/**
 * Rendered, trimmed text of every cell in each row (innerText skips icon titles). It waits for
 * the first row, so a table that is still loading is not read as empty. The read itself is one
 * shot: when more rows may still arrive, poll it with `expect.poll(() => cellTexts(rows))`.
 */
export async function cellTexts(rows: ReturnType<Page['locator']>): Promise<string[][]> {
  await expect(rows.first()).toBeAttached();
  return rows.evaluateAll((elements) => elements.map((row) =>
    [...row.querySelectorAll<HTMLElement>('th, td')].map((cell) => cell.innerText.trim())));
}

/** An instant as the API takes it, without milliseconds. */
export function iso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/** Formats money the way the page does, with the browser's locale. */
export function money(page: Page, cents: number, currency: string): Promise<string> {
  return page.evaluate(([value, code]) => new Intl.NumberFormat(undefined, { style: 'currency', currency: code as string })
    .format((value as number) / 100), [cents, currency] as const);
}

/** A Summary report and the Amount figures it shows, as cents and currency. */
export interface AmountReport {
  name: string;
  path: string;
  amounts: Array<[cents: number, currency: string]>;
}

/**
 * Seeds three Summary reports with wide Amount figures: the README screenshots' last 30 days, one
 * euro figure with six digits before the decimal point, and six-digit figures in two currencies.
 */
export async function seedWideAmounts(api: ReportApi): Promise<AmountReport[]> {
  // The screenshot data ends with a timer running since July, which the README's figure leaves out.
  const demo = screenshotExport();
  const restored = await api.importJson({ ...demo, time_entries: demo.time_entries.filter((entry) => entry.stop !== null) });
  expect(restored.errors, 'the screenshot data restores without errors').toEqual([]);
  const retainer = await api.project({ name: 'Retainer', billable: true, rate: 89_000, currency: 'EUR' });
  const licences = await api.project({ name: 'Licences', billable: true, rate: 76_543, currency: 'USD' });
  for (const start of ['2026-01-05T08:00:00Z', '2026-02-02T08:00:00Z']) {
    await api.entry({ description: 'Retainer', project_id: retainer, billable: true, start, stop: start.replace('T08', 'T18') });
  }
  await api.entry({ description: 'Licences', project_id: licences, billable: true, start: '2026-02-03T08:00:00Z', stop: '2026-02-03T18:00:00Z' });
  return [
    { name: 'the README data', path: '/reports?from=2026-06-17&to=2026-07-16', amounts: [[1_150_790, 'EUR']] },
    { name: 'six digits', path: '/reports?from=2026-01-05&to=2026-01-11', amounts: [[89_000_000, 'EUR']] },
    { name: 'two currencies', path: '/reports?from=2026-02-02&to=2026-02-08', amounts: [[89_000_000, 'EUR'], [76_543_000, 'USD']] },
  ];
}

/**
 * Opens the report and checks that each Amount figure is on one line and inside its tile, and that
 * the tile is inside the viewport. Several currencies may wrap between figures, so each figure is
 * measured on its own, from the line boxes of its text.
 */
export async function expectWholeAmounts(page: Page, report: AmountReport): Promise<void> {
  await page.goto(report.path);
  const tile = page.locator('.report-totals > div', { hasText: 'Amount' });
  const figures = await Promise.all(report.amounts.map(([cents, currency]) => money(page, cents, currency)));
  await expect(tile.locator('.report-amount'), report.name).toHaveText(figures);
  const layout = await tile.evaluate((card) => {
    const box = card.getBoundingClientRect();
    const left = box.left + card.clientLeft;
    const right = left + card.clientWidth;
    return {
      offscreen: box.right - document.documentElement.clientWidth,
      figures: [...card.querySelectorAll('.report-amount')].map((figure) => {
        const range = document.createRange();
        range.selectNodeContents(figure);
        const tops = [...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => rect.top).sort((a, b) => a - b);
        const text = range.getBoundingClientRect();
        return {
          text: figure.textContent,
          lines: tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 1).length,
          overflow: Math.max(left - text.left, text.right - right),
        };
      }),
    };
  });
  const width = page.viewportSize()!.width;
  expect(layout.offscreen, `${report.name} at ${width}px: the Amount tile overflows the viewport`).toBeLessThanOrEqual(0.5);
  for (const figure of layout.figures) {
    expect(figure.lines, `${report.name} at ${width}px: ${figure.text} lines`).toBe(1);
    expect(figure.overflow, `${report.name} at ${width}px: ${figure.text} overflows its tile`).toBeLessThanOrEqual(0.5);
  }
}
