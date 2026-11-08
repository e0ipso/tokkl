import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';

test('export downloads keep their headers and status while they stream', async () => {
  const ctx = await setup();
  const created = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, {
    start: '2026-10-05T09:00:00Z',
    duration: 3600,
    description: 'Streamed, "quoted"',
    created_with: 'test',
  });
  assert.equal(created.status, 200);
  const day = new Date().toISOString().slice(0, 10);

  const json = await ctx.request('GET', '/api/app/export.json');
  assert.equal(json.status, 200);
  assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(json.headers.get('content-disposition')!, /^attachment; filename="tokkl-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(json.headers.get('cache-control'), 'no-store');
  const body = JSON.parse(await json.text());
  assert.deepEqual(
    body.time_entries.map((e: { description: string }) => e.description),
    ['Streamed, "quoted"'],
  );

  const csv = await ctx.request('GET', '/api/app/export.csv?start_date=2026-10-01&end_date=2026-10-31');
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(csv.headers.get('content-disposition'), `attachment; filename="tokkl-entries-${day}.csv"`);
  const lines = (await csv.text()).split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /"Streamed, ""quoted"""/);
});

test('an export refused before its first piece still gets its error reply', async () => {
  const ctx = await setup();
  const range = await ctx.json('GET', '/api/app/export.csv?start_date=2026-13-01');
  assert.equal(range.status, 400);
  assert.equal(range.body, 'Invalid start_date: expected YYYY-MM-DD');
  assert.equal(range.headers.get('content-disposition'), null);

  const signedOut = await ctx.request('GET', '/api/app/export.json', undefined, { authorization: '' });
  assert.equal(signedOut.status, 403);
});
