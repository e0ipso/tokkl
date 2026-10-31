// History-scale measurements for Tokkl: npm run bench:history -- --help
//
// Starts the real server on a throwaway database for each fixture, loads a generated
// history through the JSON import, then times imports, lists, reports, CSV exports, writes and
// timer requests (alone and while a heavy report runs). Every measured response is also checked
// for correctness (totals, paging, counts, payload growth); a wrong answer exits 1. Timings are
// recorded, never asserted: they describe this host, not the low-power targets in docs/PRD.md.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, freemem, hostname, loadavg, platform, release, arch, totalmem } from 'node:os';
import { parseArgs } from 'node:util';
import { formatDuration } from '@tokkl/common/duration';
import { historyBackend } from './history-options.ts';
import { Server } from './history-server.ts';
import { inspectHistory } from './history-inspection.ts';
import { HistoryFailure, historyFailure, safeHistoryError, withHistoryCleanup } from './history-errors.ts';

const HELP = `Usage: npm run bench:history -- [options]

  --backend <engine>   Disposable sqlite, postgres, mysql or mariadb (default: sqlite)
  --fixtures <list>    Comma-separated fixtures to run: year, decade (default: year,decade)
  --iterations <n>     Timed repetitions per heavy request (default: 7; light requests use 3x)
  --end-date <date>    Last day of the generated history, YYYY-MM-DD (default: yesterday, UTC)
  --port <n>           Port for the throwaway server (default: 8190)
  --no-browser         Skip the browser timings
  --out <file>         Also write the full results as JSON to this file
  --help               Show this help

Operator database URL settings are refused. Each fixture owns a fresh database.
Set CHROMIUM_PATH to use a Chromium other than the one Playwright installed.
`;

// ----- options ---------------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    backend: { type: 'string' },
    fixtures: { type: 'string', default: 'year,decade' },
    iterations: { type: 'string', default: '7' },
    'end-date': { type: 'string' },
    port: { type: 'string', default: '8190' },
    'no-browser': { type: 'boolean', default: false },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const backend = historyBackend(args.backend, process.env);

interface FixtureSpec {
  name: string;
  description: string;
  entries: number;
  days: number;
  projects: number;
}

// "decade" is the comparison fixture from the 2026-10-14 audit: 30k entries, 30 projects with a task each.
const FIXTURES: Record<string, FixtureSpec> = {
  year: { name: 'year', description: 'one year, about 8 entries a day', entries: 3_000, days: 365, projects: 30 },
  decade: { name: 'decade', description: 'ten years, about 8 entries a day (audit comparison fixture)', entries: 30_000, days: 3_650, projects: 30 },
};

const fixtureNames = args.fixtures.split(',').map((name) => name.trim()).filter(Boolean);
for (const name of fixtureNames) if (!FIXTURES[name]) fail(`Unknown fixture "${name}". Known: ${Object.keys(FIXTURES).join(', ')}`);
const iterations = Number(args.iterations);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) fail('--iterations must be an integer from 1 to 100');
const port = Number(args.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port must be from 1024 to 65535');
const endDate = args['end-date'] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) fail('--end-date must be YYYY-MM-DD');

const TIMEZONE = 'Europe/Madrid';
const SETUP_CODE = 'BENCH-SETUP-CODE';
const DESCRIPTIONS = Array.from({ length: 40 }, (_, i) => `Task ${String(i + 1).padStart(2, '0')}`);
const TAGS = ['meeting', 'review', 'deep-work', 'support', 'admin'];

function fail(message: string): never {
  process.stderr.write(`bench: ${message}\n`);
  process.exit(2);
}

// ----- generated history -----------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32), so a fixture is the same on every run for the same end date. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface Expected {
  startDate: string;
  endDate: string;
  entries: number;
  seconds: number;
  billableSeconds: number;
  projectSeconds: Map<string, number>;
  recentEntries: number;
  recentStart: string;
}

/**
 * Entries sit in 75-minute slots from 07:00 UTC (at most 9 a day), so they never overlap and stay
 * inside one Europe/Madrid day. Durations are 15 to 70 minutes.
 */
function generate(spec: FixtureSpec): { file: unknown; expected: Expected } {
  const next = random(spec.entries * 31 + spec.days);
  const startDate = addDays(endDate, -(spec.days - 1));
  const projects = Array.from({ length: spec.projects }, (_, i) => ({
    id: i + 1, name: `Project ${String(i + 1).padStart(2, '0')}`, client_id: (i % 5) + 1, active: true, billable: i % 3 === 0,
  }));
  const tasks = projects.map((project) => ({ id: project.id, project_id: project.id, name: `${project.name} task`, active: true }));
  const clients = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Client ${i + 1}` }));
  const tags = TAGS.map((name, i) => ({ id: i + 1, name }));
  const recentStart = addDays(endDate, -8);
  const expected: Expected = {
    startDate, endDate, entries: spec.entries, seconds: 0, billableSeconds: 0, projectSeconds: new Map(), recentEntries: 0, recentStart,
  };

  const entries = [];
  let day = -1;
  let slot = 0;
  for (let i = 0; i < spec.entries; i++) {
    const entryDay = Math.floor((i * spec.days) / spec.entries);
    slot = entryDay === day ? slot + 1 : 0;
    day = entryDay;
    const date = addDays(startDate, entryDay);
    const start = Date.parse(`${date}T07:00:00Z`) + slot * 75 * 60_000;
    const seconds = (15 + Math.floor(next() * 56)) * 60;
    const project = projects[Math.floor(next() * projects.length)]!;
    const billable = next() < 0.3;
    entries.push({
      id: i + 1,
      description: DESCRIPTIONS[Math.floor(next() * DESCRIPTIONS.length)],
      start: isoSeconds(start),
      stop: isoSeconds(start + seconds * 1000),
      project_id: project.id,
      task_id: next() < 0.5 ? project.id : null,
      tag_ids: next() < 0.4 ? [1 + Math.floor(next() * TAGS.length)] : [],
      billable,
    });
    expected.seconds += seconds;
    if (billable) expected.billableSeconds += seconds;
    expected.projectSeconds.set(project.name, (expected.projectSeconds.get(project.name) ?? 0) + seconds);
    if (date >= recentStart) expected.recentEntries++;
  }
  return {
    file: { format: 'tokkl-export', version: 1, clients, projects, tasks, tags, time_entries: entries },
    expected,
  };
}

// ----- server and HTTP -------------------------------------------------------------------------

let interrupted = false;
const interrupt = () => { interrupted = true; };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

class Client {
  readonly base: string;
  readonly workspaceId: number;
  readonly userId: number;
  private readonly auth: string;

  constructor(base: string, auth: string, workspaceId: number, userId: number) {
    this.base = base;
    this.auth = auth;
    this.workspaceId = workspaceId;
    this.userId = userId;
  }

  static async create(server: Server): Promise<Client> {
    const setup = await fetch(`${server.base}/api/app/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tokkl-CSRF': '1' },
      body: JSON.stringify({ setup_code: SETUP_CODE, email: 'bench@example.com', password: 'bench password', fullname: 'Bench', timezone: TIMEZONE }),
    });
    check(setup.ok, `account setup answered ${setup.status}`);
    const cookie = setup.headers.get('set-cookie')?.split(';')[0] ?? '';
    const me = await (await fetch(`${server.base}/api/v9/me`, { headers: { cookie } })).json() as { id: number; api_token: string; default_workspace_id: number; time_resolution_minutes: number };
    equal(me.time_resolution_minutes, 5, 'unchanged default five-minute time resolution');
    return new Client(server.base, `Basic ${Buffer.from(`${me.api_token}:api_token`).toString('base64')}`, me.default_workspace_id, me.id);
  }

  async request(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; bytes: number; ms: number; data: any }> {
    if (interrupted) throw new Error('Benchmark interrupted');
    const started = performance.now();
    const response = await fetch(`${this.base}${path}`, {
      method,
      signal: AbortSignal.timeout(300000),
      headers: { authorization: this.auth, ...(body === undefined ? {} : { 'Content-Type': raw ? 'text/plain' : 'application/json' }) },
      body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
    });
    const text = await response.text();
    const ms = performance.now() - started;
    let data: unknown = text;
    if ((response.headers.get('content-type') ?? '').includes('json') && text) {
      try { data = JSON.parse(text); }
      catch { throw Object.assign(new Error(`${method} ${path} returned invalid JSON`), { name: 'HTTPResponseError', status: response.status }); }
    }
    return { status: response.status, bytes: Buffer.byteLength(text), ms, data };
  }

  /** Like request(), but a non-2xx answer is a failed check. */
  async ok(method: string, path: string, body?: unknown, raw = false) {
    const result = await this.request(method, path, body, raw);
    const successful = result.status >= 200 && result.status < 300;
    check(successful, `${method} ${path} answered ${result.status}`);
    if (!successful) throw Object.assign(new Error(`${method} ${path} answered ${result.status}`), { name: 'HTTPError', status: result.status });
    return result;
  }
}

// ----- checks and statistics -------------------------------------------------------------------

const failures: string[] = [];
let checks = 0;

function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

interface Stats { n: number; median: number; p95: number; min: number; max: number }

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { n: sorted.length, median: round(at(0.5)), p95: round(at(0.95)), min: round(sorted[0]!), max: round(sorted.at(-1)!) };
}

interface Measurement { name: string; ms: Stats; samples_ms?: number[]; bytes?: number; note?: string }

async function measure(
  list: Measurement[], name: string, times: number,
  run: () => Promise<{ ms: number; bytes?: number }>, note?: string,
): Promise<void> {
  const samples: number[] = [];
  let bytes: number | undefined;
  for (let i = 0; i < times; i++) {
    const result = await run();
    samples.push(result.ms);
    bytes = result.bytes;
  }
  list.push({ name, ms: stats(samples), samples_ms: samples, ...(bytes === undefined ? {} : { bytes }), ...(note ? { note } : {}) });
}

// ----- one fixture -----------------------------------------------------------------------------

interface ReportJson {
  totals: { seconds: number; billable_seconds: number; entry_count: number };
  series: unknown[];
  resolution: string;
  groups: Array<{ title: string; seconds: number; sub_groups: Array<{ seconds: number }> }>;
}

async function runFixture(spec: FixtureSpec) {
  const loadBefore = loadavg();
  const resourcesBefore = resourceSample();
  const { file, expected } = generate(spec);
  const results: Measurement[] = [];
  let cleanup: unknown;
  try {
    const server = await Server.start(backend, port, SETUP_CODE);
    cleanup = server.cleanupEvidence;
    return await withHistoryCleanup(async () => {
    const client = await Client.create(server);
    const ws = `/api/v9/workspaces/${client.workspaceId}`;
    const range = { start_date: expected.startDate, end_date: expected.endDate, rounding: 0 };
    const light = iterations * 3;

    // Import: the generated history goes in through the JSON restore, once.
    const imported = await client.ok('POST', '/api/app/import/json', JSON.stringify(file), true);
    results.push({ name: 'import JSON restore (whole history, once)', ms: stats([imported.ms]), samples_ms: [imported.ms], bytes: Buffer.byteLength(JSON.stringify(file)), note: 'bytes = request size' });
    equal(imported.data.time_entries, expected.entries, `${spec.name}: imported entries`);
    equal(imported.data.projects, spec.projects, `${spec.name}: imported projects`);
    equal(imported.data.errors.length, 0, `${spec.name}: import errors`);

    // Lists the app and Toggl clients use.
    await measure(results, 'list entries, last 9 days (timer page)', light, async () => {
      const result = await client.ok('GET', `/api/v9/me/time_entries?start_date=${expected.recentStart}&end_date=${addDays(expected.endDate, 1)}&meta=true`);
      equal(result.data.length, expected.recentEntries, `${spec.name}: entries in the last 9 days`);
      return result;
    });
    await measure(results, 'list projects with tracked totals', light, async () => {
      const result = await client.ok('GET', `${ws}/projects?active=both`);
      equal(result.data.length, spec.projects, `${spec.name}: project count`);
      for (const project of result.data as Array<{ name: string; actual_seconds: number }>) {
        equal(project.actual_seconds, expected.projectSeconds.get(project.name) ?? 0, `${spec.name}: tracked seconds of ${project.name}`);
      }
      return result;
    });

    // Reports over the whole history.
    const checkTotals = (report: ReportJson, label: string) => {
      equal(report.totals.seconds, expected.seconds, `${spec.name}: ${label} total seconds`);
      equal(report.totals.billable_seconds, expected.billableSeconds, `${spec.name}: ${label} billable seconds`);
      equal(report.totals.entry_count, expected.entries, `${spec.name}: ${label} entry count`);
      equal(report.groups.reduce((sum, group) => sum + group.seconds, 0), expected.seconds, `${spec.name}: ${label} group seconds add up`);
    };
    // Payload growth: a report is sized by its groups and buckets, never by the number of entries.
    const checkGrowth = (bytes: number, items: number, label: string) => {
      check(bytes <= 2_000 + items * 400, `${spec.name}: ${label} is ${bytes} bytes for ${items} groups and buckets; it should not grow with entries`);
    };
    await measure(results, 'report summary, projects by description', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report', { ...range, grouping: 'projects', sub_grouping: 'time_entries' });
      const report = result.data as ReportJson;
      checkTotals(report, 'summary');
      equal(report.groups.length, spec.projects, `${spec.name}: summary groups`);
      const subGroups = report.groups.reduce((sum, group) => sum + group.sub_groups.length, 0);
      check(subGroups <= spec.projects * DESCRIPTIONS.length, `${spec.name}: summary sub-groups (${subGroups}) are per description, not per entry`);
      checkGrowth(result.bytes, report.groups.length + subGroups + report.series.length, 'summary report');
      return result;
    });
    await measure(results, 'report totals only (detailed and weekly tabs)', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report', { ...range, grouping: 'projects', sub_grouping: 'projects' });
      const report = result.data as ReportJson;
      checkTotals(report, 'totals-only');
      check(report.groups.every((group) => group.sub_groups.length === 0), `${spec.name}: totals-only report has no sub-groups`);
      checkGrowth(result.bytes, report.groups.length + report.series.length, 'totals-only report');
      return result;
    });
    await measure(results, 'report weekly grid, rows by project', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report/weekly', { ...range, rows: 'projects' });
      equal(result.data.total, expected.seconds, `${spec.name}: weekly total`);
      equal(result.data.rows.length, spec.projects, `${spec.name}: weekly rows`);
      checkGrowth(result.bytes, result.data.columns.length * (result.data.rows.length + 2), 'weekly grid');
      return result;
    });
    const pages = Math.ceil(expected.entries / 100);
    await measure(results, 'detailed report, first page of 100', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report/entries', { ...range, page: 1 });
      equal(result.data.total, expected.entries, `${spec.name}: detailed total`);
      equal(result.data.pages, pages, `${spec.name}: detailed pages`);
      equal(result.data.entries.length, 100, `${spec.name}: first page size`);
      check(result.bytes <= 100 * 1_000, `${spec.name}: a page of 100 entries is ${result.bytes} bytes`);
      return result;
    });
    {
      const last = await client.ok('POST', '/api/app/report/entries', { ...range, page: pages + 5 });
      equal(last.data.page, pages, `${spec.name}: a page past the end returns the last page`);
      equal(last.data.entries.length, expected.entries - (pages - 1) * 100, `${spec.name}: last page size`);
      const tooBig = await client.request('POST', '/api/app/report/entries', { ...range, page_size: 501 });
      equal(tooBig.status, 400, `${spec.name}: page_size above 500 is refused`);
    }
    await measure(results, 'detailed CSV export, whole history', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report/detailed.csv', range);
      const lines = (result.data as string).trimEnd().split('\n').length;
      equal(lines, expected.entries + 1, `${spec.name}: detailed CSV rows plus header`);
      return result;
    });
    await measure(results, 'summary CSV export, whole history', iterations, async () => {
      const result = await client.ok('POST', '/api/app/report/summary.csv', { ...range, grouping: 'projects', sub_grouping: 'time_entries' });
      check((result.data as string).length > 0, `${spec.name}: summary CSV is not empty`);
      return result;
    });

    // Toggl CSV import preview of 1000 rows: a dry run must not store anything.
    const csv = ['Description,Project,Client,Task,Tags,Start date,Start time,End date,End time'];
    for (let i = 0; i < 1000; i++) {
      const date = addDays(expected.startDate, -1 - Math.floor(i / 9));
      const hour = 7 + (i % 9);
      csv.push(`CSV row ${i},Project ${String((i % spec.projects) + 1).padStart(2, '0')},Client ${(i % 5) + 1},,,${date},${String(hour).padStart(2, '0')}:00:00,${date},${String(hour).padStart(2, '0')}:45:00`);
    }
    await measure(results, 'Toggl CSV import preview, 1000 rows', iterations, async () => {
      const result = await client.ok('POST', '/api/app/import/toggl-csv?dry_run=true', csv.join('\n'), true);
      equal(result.data.rows, 1000, `${spec.name}: CSV preview rows`);
      equal(result.data.errors.length, 0, `${spec.name}: CSV preview errors`);
      return result;
    });
    {
      const before = await client.ok('GET', `/api/v9/me/time_entries?start_date=${addDays(expected.startDate, -120)}&end_date=${expected.startDate}`);
      equal(before.data.length, 0, `${spec.name}: the CSV preview stored nothing`);
    }

    // Timer responsiveness, alone and while a whole-history CSV export is being built.
    const timerOnce = async () => {
      const start = await client.ok('POST', `${ws}/time_entries`, { description: 'Bench timer', start: isoSeconds(Date.now()), duration: -1, created_with: 'bench', workspace_id: client.workspaceId });
      check(start.data.stop === null && start.data.duration < 0, `${spec.name}: timer start returns a running entry`);
      const stop = await client.ok('PATCH', `${ws}/time_entries/${start.data.id}/stop`);
      check(stop.data.stop !== null, `${spec.name}: timer stop sets stop`);
      if (stop.data.server_deleted_at === null) {
        await client.ok('DELETE', `${ws}/time_entries/${start.data.id}`);
      } else {
        check(typeof stop.data.server_deleted_at === 'string', `${spec.name}: rounded-zero timer is marked deleted`);
        equal(stop.data.start, stop.data.stop, `${spec.name}: rounded-zero timer has no retained span`);
        equal(stop.data.duration, 0, `${spec.name}: rounded-zero timer has zero duration`);
      }
      return { start: start.ms, stop: stop.ms };
    };
    const idleStart: number[] = [];
    const idleStop: number[] = [];
    for (let i = 0; i < light; i++) {
      const { start, stop } = await timerOnce();
      idleStart.push(start);
      idleStop.push(stop);
    }
    results.push({ name: 'timer start, idle server', ms: stats(idleStart), samples_ms: idleStart }, { name: 'timer stop, idle server', ms: stats(idleStop), samples_ms: idleStop });
    const loadedOverlap: Array<{ pending_at_timer_start: boolean; pending_after_timer_stop: boolean; export_ms: number }> = [];
    const loadedStart: number[] = [];
    const loadedStop: number[] = [];
    for (let i = 0; i < iterations; i++) {
      let pending = true;
      const heavy = client.ok('POST', '/api/app/report/detailed.csv', range).finally(() => { pending = false; });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const duringStart = pending;
      const { start, stop } = await timerOnce();
      const duringStop = pending;
      loadedStart.push(start);
      loadedStop.push(stop);
      const exported = await heavy;
      loadedOverlap.push({ pending_at_timer_start: duringStart, pending_after_timer_stop: duringStop, export_ms: exported.ms });
      equal((exported.data as string).trimEnd().split('\n').length, expected.entries + 1, `${spec.name}: loaded CSV rows plus header`);
    }
    results.push({ name: 'timer start during a whole-history CSV export', ms: stats(loadedStart), samples_ms: loadedStart, note: 'request sent 5 ms after the export' });
    results.push({ name: 'timer stop right after that', ms: stats(loadedStop), samples_ms: loadedStop });
    equal((await client.ok('GET', '/api/v9/me/time_entries/current')).data, null, `${spec.name}: no timer left running`);

    // Writes on a day before the history, then cleaned up.
    const writeDay = addDays(expected.startDate, -400);
    const created: number[] = [];
    await measure(results, 'create entry', light, async () => {
      const index = created.length;
      const start = Date.parse(`${writeDay}T06:00:00Z`) + index * 60_000;
      const result = await client.ok('POST', `${ws}/time_entries`, {
        description: `Write ${index}`, start: isoSeconds(start), stop: isoSeconds(start + 5 * 60_000), project_id: null, created_with: 'bench', workspace_id: client.workspaceId,
      });
      created.push(result.data.id);
      return result;
    });
    let updates = 0;
    await measure(results, 'update entry description', light, async () => {
      const id = created[updates++ % created.length]!;
      const result = await client.ok('PUT', `${ws}/time_entries/${id}`, { description: `Updated ${id}` });
      equal(result.data.description, `Updated ${id}`, `${spec.name}: update stored the description`);
      return result;
    });
    {
      const listed = await client.ok('GET', `/api/v9/me/time_entries?start_date=${writeDay}&end_date=${addDays(writeDay, 1)}`);
      equal(listed.data.length, created.length, `${spec.name}: created entries are listed`);
    }
    let deletes = 0;
    await measure(results, 'delete entry', light, async () => client.ok('DELETE', `${ws}/time_entries/${created[deletes++]!}`));
    {
      const listed = await client.ok('GET', `/api/v9/me/time_entries?start_date=${writeDay}&end_date=${addDays(writeDay, 1)}`);
      equal(listed.data.length, 0, `${spec.name}: deleted entries are gone`);
    }

    const browser = args['no-browser'] ? { skipped: '--no-browser' } : await browserTimings(server, expected, spec);
    const inspection = await inspectHistory(server.config, client.userId, client.workspaceId, expected.startDate, addDays(expected.endDate, 1));
    equal(inspection.report.rows, expected.entries, `${spec.name}: inspected report rows`);
    equal(inspection.entry_list.rows, expected.entries, `${spec.name}: inspected entry-list rows`);
    equal(inspection.entry_list.selects, 1 + Math.ceil(expected.entries / 400), `${spec.name}: joined metadata and batched tags avoid per-entry queries`);
    equal(inspection.report.selects, 2, `${spec.name}: report metadata uses two executed queries`);
    for (const plan of inspection.explain) {
      check(plan.accepted, `${spec.name}: ${plan.name}: chosen live-entry index or bounded catalog reference, no full-history scan`);
    }
    return {
      fixture: { ...spec, start_date: expected.startDate, end_date: expected.endDate, total_hours: Math.round(expected.seconds / 36) / 100, clients: 5, tasks: spec.projects, tags: TAGS.length, descriptions: DESCRIPTIONS.length },
      load_average: { before: loadBefore.map((v) => Math.round(v * 100) / 100), after: loadavg().map((v) => Math.round(v * 100) / 100) },
      measurements: results,
      loaded_report_overlap: loadedOverlap,
      inspection,
      cleanup: server.cleanupEvidence,
      fixture_sha256: createHash('sha256').update(JSON.stringify(file)).digest('hex'),
      resources: { before: resourcesBefore, after: resourceSample() },
      browser,
    };
    }, () => server.stop());
  } catch (error) {
    if (error instanceof HistoryFailure && cleanup) error.api_cleanup = cleanup;
    const failure = historyFailure(error);
    failedFixture = { fixture: spec, measurements: results, error: failure, cleanup: cleanup ?? failure.api_cleanup, resources: { before: resourcesBefore, after: resourceSample() } };
    throw error;
  }
}

// ----- browser ---------------------------------------------------------------------------------

/** Times the timer page and the all-time summary report in Chromium, and checks the total shown. */
async function browserTimings(server: Server, expected: Expected, spec: FixtureSpec): Promise<unknown> {
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (error) {
    return { skipped: `Chromium did not start: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}` };
  }
  try {
    const context = await browser.newContext({ baseURL: server.base, timezoneId: TIMEZONE });
    const page = await context.newPage();
    const login = await page.request.post('/api/app/login', {
      headers: { 'X-Tokkl-CSRF': '1' }, data: { email: 'bench@example.com', password: 'bench password' },
    });
    check(login.ok(), `${spec.name}: browser login`);
    const timer: number[] = [];
    const reports: number[] = [];
    for (let i = 0; i < iterations; i++) {
      let started = performance.now();
      await page.goto('/');
      await page.locator('.entry-line').first().waitFor();
      timer.push(performance.now() - started);
      equal(await page.getByRole('region', { name: 'Timer' }).count(), 1, `${spec.name}: timer page renders`);

      started = performance.now();
      await page.goto(`/reports?from=${expected.startDate}&to=${expected.endDate}&tab=summary`);
      const total = page.locator('.report-totals dd').first();
      await total.filter({ hasText: /\d/ }).waitFor();
      reports.push(performance.now() - started);
      if (i === 0) {
        const shown = (await total.textContent())?.trim();
        const wanted = formatDuration(expected.seconds, 'improved');
        equal(shown, wanted, `${spec.name}: total on the report page`);
      }
    }
    return {
      browser: `Chromium ${browser.version()}`,
      measurements: [
        { name: 'timer page load until the entry list renders', ms: stats(timer) },
        { name: 'summary report page until the total renders', ms: stats(reports) },
      ],
    };
  } finally {
    await browser.close();
  }
}

// ----- main ------------------------------------------------------------------------------------

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function resourceSample() {
  const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return 'unavailable'; } };
  return { at: new Date().toISOString(), load: loadavg(), free_memory_bytes: freemem(), memory: read('/proc/meminfo'), cpu: read('/proc/stat'), pressure_cpu: read('/proc/pressure/cpu'), pressure_memory: read('/proc/pressure/memory') };
}

let failedFixture: unknown;
let failure: ReturnType<typeof historyFailure> | undefined;
const resourceSamples = [resourceSample()];
const sampling = setInterval(() => resourceSamples.push(resourceSample()), 10000);
sampling.unref();
const startedAt = new Date().toISOString();
const run = {
  kind: 'local measurement on the host below; not a check of the low-power targets',
  targets_from_prd: 'Timer start/stop under 100 ms server time and reports over a year under 500 ms, on a low-power CPU (docs/PRD.md section 9)',
  started_at: startedAt,
  backend,
  argv: process.argv,
  cwd: process.cwd(),
  settings: { host: '127.0.0.1', port, end_date: endDate, time_resolution_minutes: 5 },
  resources_before: resourceSample(),
  runtime: { node: process.version, sqlite: process.versions.sqlite, npm_agent: process.env.npm_config_user_agent ?? 'not run through npm', platform: platform(), release: release(), arch: arch() },
  host: {
    hostname: hostname(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memory_gb: Math.round(totalmem() / 2 ** 30 * 10) / 10,
    free_memory_gb: Math.round(freemem() / 2 ** 30 * 10) / 10,
    load_average: loadavg().map((v) => Math.round(v * 100) / 100),
  },
  commit: commit(),
  iterations,
  timezone: TIMEZONE,
  fixtures: [] as unknown[],
};

try {
  for (const name of fixtureNames) {
    process.stderr.write(`bench: running the ${name} fixture...\n`);
    run.fixtures.push(await runFixture(FIXTURES[name]!));
  }
} catch (error) {
  failure = historyFailure(error);
  failures.push(safeHistoryError(error).message);
} finally {
  clearInterval(sampling);
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}

const pad = (text: string, width: number) => text.padEnd(width);
const lines = [
  `Tokkl history benchmark, ${run.kind}`,
  `PRD targets: ${run.targets_from_prd}`,
  `Node ${run.runtime.node} on ${run.runtime.platform} ${run.runtime.arch}; ${run.host.cpu}, ${run.host.cores} cores, ${run.host.memory_gb} GB; load ${run.host.load_average.join(' ')}; commit ${run.commit}`,
];
for (const result of run.fixtures as Array<Awaited<ReturnType<typeof runFixture>>>) {
  const f = result.fixture;
  lines.push('', `${f.name}: ${f.entries} entries over ${f.days} days (${f.start_date} to ${f.end_date}), ${f.projects} projects and tasks, ${f.total_hours} h; load ${result.load_average.before.join(' ')} -> ${result.load_average.after.join(' ')}`);
  lines.push(`  ${pad('measurement', 58)} ${pad('median ms', 10)} ${pad('p95 ms', 10)} ${pad('max ms', 10)} bytes`);
  const browser = result.browser as { measurements?: Measurement[]; skipped?: string; browser?: string };
  for (const m of [...result.measurements, ...(browser.measurements ?? []).map((b) => ({ ...b, name: `[browser] ${b.name}` }))]) {
    lines.push(`  ${pad(m.name, 58)} ${pad(String(m.ms.median), 10)} ${pad(String(m.ms.p95), 10)} ${pad(String(m.ms.max), 10)} ${m.bytes ?? ''}`);
  }
  if (browser.skipped) lines.push(`  browser timings skipped: ${browser.skipped}`);
}
lines.push('', `${checks} checks, ${failures.length} failed`);
process.stdout.write(`${lines.join('\n')}\n`);
if (args.out) writeFileSync(args.out, `${JSON.stringify({ ...run, resource_samples: resourceSamples, failed_fixture: failedFixture, failure, resources_after: resourceSample(), checks, failures }, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`bench: wrong results:\n${failures.slice(0, 50).map((f) => `- ${f}`).join('\n')}\n`);
  process.exit(1);
}
