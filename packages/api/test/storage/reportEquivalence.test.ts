import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createReportRepositories } from '../../src/storage/repositories/reports.ts';
import type { Backend } from '../../src/storage/config.ts';
import type { ReportFilter } from '../../src/domain/reportCommands.ts';
import type { JobResult } from '../../src/services/reportJobs.ts';
import { v3WeeklyFilter } from '../../src/services/reportJobs.ts';
import { answerJob, type AnyReportJob } from './support/report-jobs.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { oracleCollect, oracleReport, oracleSelection } from './support/reportOracle.ts';

/** Deterministic pseudo-random numbers, so every backend gets the same history. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { next, int, pick: <T>(values: readonly T[]): T => values[int(values.length)]! };
}

/** Descriptions that tie, differ only in case or accents, and sort differently by code point. */
const DESCRIPTIONS = ['alpha', 'Alpha', 'ålpha', 'Éclair', 'eclair', '', '100%_\\x', 'zeta', 'Zeta ', ' space', 'b'];
/** Durations on and next to rounding boundaries, zero, and sub-second remainders. */
const DURATIONS_MS = [0, 999, 1000, 449_999, 450_000, 450_999, 900_000, 180_000, 179_999, 3_600_500];
const ENTRIES_PER_USER = 1300;

const orders = ['date', 'user', 'duration', 'description', 'last_update'] as const;
const directions = ['ASC', 'DESC'] as const;
const detailedOrders = ['date', 'duration', 'description'] as const;

/** First pages, a page deep in the list, one page for everything, and a start past the end. */
const SEARCH_WINDOWS = [
  [7, 1],
  [50, 333],
  [1000, 1],
  [10, 5000],
] as const;

/** Every job kind, each order in both directions, with windows rotating across them. */
function equivalenceJobs(filter: ReportFilter): AnyReportJob[] {
  const jobs: AnyReportJob[] = [];
  let turn = 0;
  for (const orderBy of orders)
    for (const orderDir of directions) {
      for (const [pageSize, firstRow] of [SEARCH_WINDOWS[turn % 4]!, SEARCH_WINDOWS[(turn + 1) % 4]!])
        jobs.push({ kind: 'v3-search', filter, orderBy, orderDir, pageSize, firstRow });
      turn++;
    }
  orders.forEach((orderBy, n) =>
    jobs.push({ kind: 'v3-csv', filter, orderBy, orderDir: directions[n % 2]!, durationFormat: 'improved' }),
  );
  jobs.push({ kind: 'v3-totals', filter, granularity: 'week', withGraph: true });
  jobs.push({ kind: 'v3-totals', filter, granularity: 'day', withGraph: false });
  for (const [grouping, sub] of [
    ['project', 'description'],
    ['tag', 'client'],
    ['description', 'project'],
  ] as const) {
    jobs.push({ kind: 'v3-summary', filter, grouping, sub, includeIds: grouping !== 'tag' });
    jobs.push({ kind: 'app-report', filter, grouping, sub });
  }
  jobs.push({ kind: 'app-report', filter, grouping: 'tag', sub: 'tag' });
  jobs.push({ kind: 'v3-summary-csv', filter, grouping: 'tag', sub: 'description', durationFormat: 'classic' });
  jobs.push({ kind: 'app-summary-csv', filter, grouping: 'client', sub: 'task', durationFormat: 'improved' });
  jobs.push({ kind: 'v3-weekly', ...v3WeeklyFilter(filter) });
  jobs.push({ kind: 'app-weekly', filter, rows: 'projects' });
  jobs.push({ kind: 'app-weekly', filter, rows: 'clients' });
  detailedOrders.forEach((orderBy, n) => {
    for (const orderDir of directions)
      for (const [pageSize, page] of [[7, 1], orderDir === 'ASC' ? [100, 4] : [500, 999]] as const)
        jobs.push({ kind: 'app-entries', filter, orderBy, orderDir, pageSize, page });
    jobs.push({ kind: 'app-detailed-csv', filter, orderBy, orderDir: directions[n % 2]!, durationFormat: 'decimal' });
  });
  return jobs;
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as Backend[]) {
  test(
    `${backend}: every report job matches the whole-list pipeline on a varied history`,
    { timeout: 1800000 },
    async t => {
      const fixture = await disposableBackend(backend);
      t.after(() => fixture.cleanup());
      const connection = await initializeDatabase(fixture.config);
      t.after(() => connection.close());
      const operations = createTransactionRunner(connection, db => ({
        ...entryTimerFactory(backend)(db),
        ...createReportRepositories(db, backend),
      }));
      const rand = random(20261101);
      const accounts = [
        { name: 'equivalence-a', timezone: 'Europe/Madrid', beginningOfWeek: 1, rate: 50, currency: 'EUR' },
        { name: 'equivalence-b', timezone: 'America/New_York', beginningOfWeek: 0, rate: null, currency: 'USD' },
      ];
      for (const account of accounts) {
        const seeded = await operations.transaction(async ctx => {
          const created = await ctx.users.createAccount({ ...entryAccount(account.name), timezone: account.timezone });
          const user = await ctx.users.updateAccount(created.id, { beginningOfWeek: account.beginningOfWeek });
          const wid = user.defaultWorkspaceId;
          const ws = await ctx.workspaces.update(wid, {
            defaultCurrency: account.currency,
            defaultHourlyRate: account.rate,
          });
          const acme = await ctx.clients.create({ workspaceId: wid, name: 'ACME', notes: null, archived: false });
          const beta = await ctx.clients.create({ workspaceId: wid, name: 'beta', notes: null, archived: false });
          const project = (name: string, clientId: number | null, rate: number | null, currency: string | null) =>
            ctx.projects.create({
              workspaceId: wid,
              clientId,
              name,
              color: `#${name.length}0${name.length}0${name.length}0`,
              active: true,
              isPrivate: true,
              billable: true,
              estimatedHours: null,
              rate,
              currency,
              fixedFee: null,
              startDate: null,
              endDate: null,
              template: false,
            });
          const projects = [
            await project('Website', acme.id, 80, 'USD'),
            await project('Backlog', beta.id, null, null),
            await project('Internal', null, 30, null),
          ];
          const tasks = [
            await ctx.tasks.create({
              workspaceId: wid,
              projectId: projects[0]!.id,
              name: 'Design',
              active: true,
              estimatedSeconds: null,
            }),
            await ctx.tasks.create({
              workspaceId: wid,
              projectId: projects[1]!.id,
              name: 'Triage',
              active: true,
              estimatedSeconds: null,
            }),
          ];
          const tags = await ctx.tags.resolveNames(wid, ['zebra', 'Alpha', 'éclair', 'beta']);
          return { user, ws, projects, tasks, tags };
        });
        const { user, ws, projects, tasks, tags } = seeded;
        const first = Date.UTC(2026, 8, 30, 20);
        const updates = Array.from({ length: 40 }, (_, i) =>
          new Date(Date.UTC(2026, 10, 2) + i * 37_000).toISOString(),
        );
        const starts: number[] = [];
        const rows = Array.from({ length: ENTRIES_PER_USER }, (_, i) => {
          const start =
            starts.length && rand.next() < 0.12
              ? rand.pick(starts)
              : first + rand.int(34 * 24 * 60) * 60_000 + rand.pick([0, 0, 1, 500, 999, rand.int(1000)]);
          starts.push(start);
          const duration = rand.next() < 0.6 ? rand.pick(DURATIONS_MS) : rand.int(4 * 3_600_000);
          const project = rand.pick([...projects, null, null]);
          const task =
            project?.id === projects[0]!.id && rand.next() < 0.7
              ? tasks[0]!
              : project?.id === projects[1]!.id && rand.next() < 0.5
                ? tasks[1]!
                : null;
          return {
            user_id: user.id,
            workspace_id: ws.id,
            project_id: project?.id ?? null,
            task_id: task?.id ?? null,
            description: rand.pick(DESCRIPTIONS),
            start: new Date(start).toISOString(),
            // One running entry per account; the reports skip it.
            stop: i === 17 ? null : new Date(start + duration).toISOString(),
            billable: Number(rand.next() < 0.6),
            duronly: 0,
            all_day: Number(rand.next() < 0.05),
            deleted_at: rand.next() < 0.03 ? updates[0]! : null,
            created_with: 'test',
            created_at: updates[0]!,
            updated_at: rand.pick(updates),
          };
        });
        for (let i = 0; i < rows.length; i += 100)
          await connection.db
            .insertInto('time_entries')
            .values(rows.slice(i, i + 100))
            .execute();
        const ids = await connection.db
          .selectFrom('time_entries')
          .select('id')
          .where('user_id', '=', user.id)
          .orderBy('id')
          .execute();
        assert.equal(ids.length, rows.length);
        const links = ids.flatMap(({ id }) =>
          tags.filter(() => rand.next() < 0.3).map(tag => ({ time_entry_id: Number(id), tag_id: tag.id })),
        );
        for (let i = 0; i < links.length; i += 200)
          await connection.db
            .insertInto('time_entry_tags')
            .values(links.slice(i, i + 200))
            .execute();

        const october = { startDate: '2026-10-01', endDate: '2026-10-31' };
        const filters: ReportFilter[] = [
          october,
          { ...october, rounding: 1, roundingMinutes: 15 },
          // One week across the end of daylight saving time, rounding to the nearest step.
          { startDate: '2026-10-19', endDate: '2026-10-25', rounding: 0, roundingMinutes: 15 },
          {
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            rounding: -1,
            roundingMinutes: 6,
            projectIds: [projects[0]!.id, null],
            excludeTagIds: [tags[0]!.id],
            minDurationSeconds: 1,
          },
          { ...october, description: 'a', billable: true },
        ];
        const oracleRows = new Map<string, Awaited<ReturnType<typeof oracleCollect>>>();
        let compared = 0;
        for (const filter of filters)
          for (const job of equivalenceJobs(filter)) {
            const key = JSON.stringify(job.filter);
            let expectedRows = oracleRows.get(key);
            if (!expectedRows) {
              const selection = oracleSelection(job.filter, user.timezone);
              expectedRows = await oracleCollect(connection.db, backend, user.id, ws.id, selection);
              oracleRows.set(key, expectedRows);
            }
            const expected: JobResult = oracleReport(expectedRows, user, ws, job);
            const actual = await answerJob(operations, { userId: user.id, workspaceId: ws.id, job });
            assert.deepEqual(actual, expected, `${backend} ${account.name} ${JSON.stringify(job)}`);
            compared++;
          }
        // The fixture must reach past a page and a read batch, with ties to break.
        const all = oracleRows.get(JSON.stringify(october))!;
        assert.ok(all.length > 1000, `only ${all.length} entries in range`);
        assert.ok(new Set(all.map(r => r.start)).size < all.length, 'no start ties');
        console.log(JSON.stringify({ backend, account: account.name, entries: all.length, compared }));
      }
    },
  );
}
