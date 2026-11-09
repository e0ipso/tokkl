import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageFor } from './fixtures/database.ts';
import { createApp } from '../src/app.ts';
import { createReportRunner } from '../src/reportRunners.ts';
import { runReport } from './fixtures/reportRunner.ts';
import type { JobSource } from '../src/services/reportExecution.ts';
import { setup, testConfig, testServer } from './helpers.ts';

const RANGE = { start_date: '2026-10-05', end_date: '2026-10-11' };

test('detailed CSV reports stream in the download lane while the report queue is full', async t => {
  const ctx = await setup({ sqlite: true });
  for (const [start, description] of [
    ['2026-10-05T09:00:00Z', 'first'],
    ['2026-10-06T10:00:00Z', 'second, with "quotes"'],
    ['2026-10-07T11:00:00Z', 'third'],
  ] as const) {
    const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
      start,
      duration: 1800,
      description,
      created_with: 'test',
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
  }
  const storage = storageFor(ctx.db);
  // The first read is a report that waits until the test ends, so it holds the report queue's one place.
  let release!: () => void;
  const held = new Promise<void>(resolve => (release = resolve));
  let reads = 0;
  const source: JobSource = {
    readSnapshot: async work => {
      if (++reads === 1) {
        await held;
        throw new Error('released');
      }
      return storage.readSnapshot(work);
    },
  };
  const reports = createReportRunner(testConfig(ctx.db).storage, source, { maxQueue: 1 });
  const holding = runReport(reports, ctx.user.id, ctx.wid, {
    kind: 'v3-weekly',
    filter: { startDate: '2026-10-05', endDate: '2026-10-11' },
    weekStart: '2026-10-05',
  }).catch(() => {});
  const app = createApp({ storage, config: testConfig(ctx.db), setup: { code: null }, reports });
  t.after(async () => {
    release();
    await holding;
    await app.locals.close();
  });
  const server = testServer(app);
  const auth = { authorization: `Basic ${Buffer.from(`${ctx.user.apiToken}:api_token`).toString('base64')}` };
  const post = (path: string) =>
    server.request(path, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(RANGE),
    });
  while (reads === 0) await new Promise(resolve => setImmediate(resolve));

  const queued = await post('/api/app/report');
  assert.equal(queued.status, 503, 'the report queue is full');
  assert.equal(await queued.json(), 'Report queue is full');

  for (const [path, filename] of [
    ['/api/app/report/detailed.csv', 'tokkl_detailed.csv'],
    [`/reports/api/v3/workspace/${ctx.wid}/search/time_entries.csv`, 'Toggl_time_entries.csv'],
  ] as const) {
    const response = await post(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${filename}"`);
    const body = await response.text();
    assert.equal(body, await (await ctx.request('POST', path, RANGE)).text(), path);
    assert.equal(body.split('\r\n').filter(Boolean).length, 4, `${path}: the header and three entries`);
    assert.match(body, /"second, with ""quotes"""/);
  }
});
