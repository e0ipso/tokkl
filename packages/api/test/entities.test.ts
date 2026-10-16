import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './helpers.ts';
import { openDatabase } from '../src/db/index.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';

test('clients CRUD, archive cascades to projects, restore', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME', notes: 'net 30' });
  assert.equal(client.status, 200);
  assert.equal(client.body.wid, ctx.wid);
  assert.equal(client.body.archived, false);

  const dup = await ctx.json('POST', `${base}/clients`, { name: 'acme' });
  assert.equal(dup.status, 400);

  const project = await ctx.json('POST', `${base}/projects`, { name: 'Website', client_id: client.body.id });
  assert.equal(project.body.client_id, client.body.id);
  assert.equal(project.body.cid, client.body.id);
  assert.equal(project.body.client_name, 'ACME');
  assert.match(project.body.color, /^#[0-9a-f]{6}$/);

  const archived = await ctx.json('POST', `${base}/clients/${client.body.id}/archive`);
  assert.deepEqual(archived.body, [project.body.id]);
  const archivedProject = await ctx.json('GET', `${base}/projects/${project.body.id}`);
  assert.equal(archivedProject.body.active, false);
  assert.equal(archivedProject.body.status, 'archived');

  const activeOnly = await ctx.json('GET', `${base}/clients?status=active`);
  assert.equal(activeOnly.body.length, 0);

  const restored = await ctx.json('POST', `${base}/clients/${client.body.id}/restore`);
  assert.equal(restored.body.archived, false);

  const renamed = await ctx.json('PUT', `${base}/clients/${client.body.id}`, { name: 'ACME Corp' });
  assert.equal(renamed.body.name, 'ACME Corp');

  assert.equal((await ctx.request('DELETE', `${base}/clients/${client.body.id}`)).status, 200);
  const orphan = await ctx.json('GET', `${base}/projects/${project.body.id}`);
  assert.equal(orphan.body.client_id, null);
});

test('projects: filters, actual_seconds, delete keeps or removes entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const a = await ctx.json('POST', `${base}/projects`, { name: 'Alpha', billable: true, rate: 80, currency: 'eur', estimated_hours: 10 });
  assert.equal(a.body.currency, 'EUR');
  assert.equal(a.body.estimated_seconds, 36000);
  const b = await ctx.json('POST', `${base}/projects`, { name: 'Beta', active: false });

  await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 5400, project_id: a.body.id });
  const withTime = await ctx.json('GET', `${base}/projects/${a.body.id}`);
  assert.equal(withTime.body.actual_seconds, 5400);
  assert.equal(withTime.body.actual_hours, 1);

  const active = await ctx.json('GET', `${base}/projects?active=true`);
  assert.deepEqual(active.body.map((p: any) => p.name), ['Alpha']);
  const both = await ctx.json('GET', `${base}/projects`);
  assert.equal(both.body.length, 2);
  const me = await ctx.json('GET', '/api/v9/me/projects');
  assert.deepEqual(me.body.map((p: any) => p.name), ['Alpha']);

  const badColor = await ctx.json('PUT', `${base}/projects/${b.body.id}`, { color: 'red' });
  assert.equal(badColor.status, 400);

  const entries = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02');
  assert.equal(entries.body.length, 1);
  assert.equal((await ctx.request('DELETE', `${base}/projects/${a.body.id}`)).status, 200);
  const kept = await ctx.json('GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02');
  assert.equal(kept.body.length, 1);
  assert.equal(kept.body[0].project_id, null);
});

test('tasks belong to projects and set the project on entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha' });
  const other = await ctx.json('POST', `${base}/projects`, { name: 'Other' });
  const task = await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design', estimated_seconds: 3600 });
  assert.equal(task.status, 200);
  assert.equal(task.body.project_id, project.body.id);

  const entry = await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60, task_id: task.body.id });
  assert.equal(entry.body.project_id, project.body.id);
  const mismatch = await ctx.json('POST', `${base}/time_entries`, {
    start: '2026-10-01T08:00:00Z', duration: 60, task_id: task.body.id, project_id: other.body.id,
  });
  assert.equal(mismatch.status, 400);

  const listed = await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].tracked_seconds, 60_000);
  const done = await ctx.json('PUT', `${base}/projects/${project.body.id}/tasks/${task.body.id}`, { active: false });
  assert.equal(done.body.active, false);
});

test('tags: create, rename, duplicate check, delete removes from entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const tag = await ctx.json('POST', `${base}/tags`, { name: 'urgent' });
  assert.equal(tag.status, 200);
  assert.equal(tag.body.name, 'urgent');
  assert.equal((await ctx.json('POST', `${base}/tags`, { name: 'URGENT' })).status, 400);
  assert.equal((await ctx.json('POST', `${base}/tags`, { name: '  ' })).status, 400);

  const entry = await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 60, tag_ids: [tag.body.id] });
  assert.deepEqual(entry.body.tags, ['urgent']);
  const renamed = await ctx.json('PUT', `${base}/tags/${tag.body.id}`, { name: 'later' });
  assert.equal(renamed.body.name, 'later');
  assert.equal((await ctx.request('DELETE', `${base}/tags/${tag.body.id}`)).status, 200);
  const after = await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`);
  assert.deepEqual(after.body.tags, []);
});

test('preferences merge and /me with related data', async () => {
  const ctx = await setup();
  const saved = await ctx.json('POST', '/api/v9/me/preferences', { duration_format: 'decimal', custom_key: 1 });
  assert.equal(saved.body.duration_format, 'decimal');
  const read = await ctx.json('GET', '/api/v9/me/preferences');
  assert.equal(read.body.custom_key, 1);
  assert.equal(read.body.timeofday_format, 'H:mm');

  const related = await ctx.json('GET', '/api/v9/me?with_related_data=true');
  assert.equal(related.body.workspaces.length, 1);
  assert.ok(Array.isArray(related.body.projects));

  const ws = await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}`, { name: 'Home', default_currency: 'usd', default_hourly_rate: 50 });
  assert.equal(ws.body.name, 'Home');
  assert.equal(ws.body.default_currency, 'USD');
});

test('task listings follow Toggl shapes: workspace envelope, project array, paging', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha' });
  for (const name of ['a', 'b', 'c']) await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name });
  const last = await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`);
  await ctx.json('PUT', `${base}/projects/${project.body.id}/tasks/${last.body[2].id}`, { active: false });

  const envelope = await ctx.json('GET', `${base}/tasks?per_page=2&active=both`);
  assert.equal(envelope.body.total_count, 3);
  assert.equal(envelope.body.data.length, 2);
  assert.equal(envelope.body.page, 1);

  assert.equal((await ctx.json('GET', `${base}/projects/${project.body.id}/tasks`)).body.length, 3);
  assert.equal((await ctx.json('GET', `${base}/projects/${project.body.id}/tasks?active=true`)).body.length, 2);
  assert.equal((await ctx.json('GET', '/api/v9/me/tasks')).body.length, 2);
  assert.equal((await ctx.json('GET', '/api/v9/me/tasks?include_not_active=true')).body.length, 3);

  for (const name of ['p1', 'p2']) await ctx.json('POST', `${base}/projects`, { name });
  assert.equal((await ctx.json('GET', `${base}/projects`)).body.length, 3);
  assert.equal((await ctx.json('GET', `${base}/projects?per_page=2&page=2`)).body.length, 1);
});

test('client_id null clears a project client; legacy cid still works', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME' });
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Site', cid: client.body.id });
  assert.equal(project.body.client_id, client.body.id);
  const cleared = await ctx.json('PUT', `${base}/projects/${project.body.id}`, { client_id: null });
  assert.equal(cleared.body.client_id, null);
  const renamed = await ctx.json('PUT', `${base}/projects/${project.body.id}`, { name: 'Site 2' });
  assert.equal(renamed.body.client_id, null);
});

// Hourly rates must be finite, non-negative and at most 1e9.
const BAD_RATES: Array<[string, string]> = [
  ['1e400', 'expected a non-negative number'],
  ['-1', 'expected a non-negative number'],
  ['"abc"', 'expected a non-negative number'],
  ['true', 'expected a non-negative number'],
  ['1000000000.5', 'expected at most 1000000000'],
  ['1e10', 'expected at most 1000000000'],
];

test('workspace default_hourly_rate rejects overflow, negatives, non-numbers and values above the cap', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}`;
  await ctx.json('PUT', url, { name: 'Home', default_hourly_rate: 50 });

  for (const [raw, reason] of BAD_RATES) {
    // Sent as raw JSON text so 1e400 reaches the server and parses to Infinity there.
    const res = await ctx.json('PUT', url, `{"name": "Changed", "default_hourly_rate": ${raw}}`);
    assert.deepEqual([res.status, res.body], [400, `Invalid default_hourly_rate: ${reason}`], raw);
    const ws = await ctx.json('GET', url);
    assert.equal(ws.body.default_hourly_rate, 50, raw);
    assert.equal(ws.body.name, 'Home', raw);
  }

  for (const rate of [0, 42.5, 1e9, null]) {
    const res = await ctx.json('PUT', url, { default_hourly_rate: rate });
    assert.equal(res.status, 200, String(rate));
    assert.equal(res.body.default_hourly_rate, rate);
    assert.equal((await ctx.json('GET', url)).body.default_hourly_rate, rate);
  }
});

test('project rate rejects bad values on create and update and keeps the stored rate', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha', rate: 80 });

  for (const [raw, reason] of BAD_RATES) {
    const created = await ctx.json('POST', `${base}/projects`, `{"name": "Bad", "rate": ${raw}}`);
    assert.deepEqual([created.status, created.body], [400, `Invalid rate: ${reason}`], raw);
    const updated = await ctx.json('PUT', `${base}/projects/${project.body.id}`, `{"name": "Renamed", "rate": ${raw}}`);
    assert.deepEqual([updated.status, updated.body], [400, `Invalid rate: ${reason}`], raw);
    const stored = await ctx.json('GET', `${base}/projects/${project.body.id}`);
    assert.equal(stored.body.rate, 80, raw);
    assert.equal(stored.body.name, 'Alpha', raw);
  }
  assert.deepEqual((await ctx.json('GET', `${base}/projects`)).body.map((p: any) => p.name), ['Alpha']);

  for (const [i, rate] of [0, 42.5, 1e9, null].entries()) {
    const created = await ctx.json('POST', `${base}/projects`, { name: `Rate ${i}`, rate });
    assert.equal(created.status, 200, String(rate));
    assert.equal(created.body.rate, rate);
    const updated = await ctx.json('PUT', `${base}/projects/${project.body.id}`, { rate });
    assert.equal(updated.status, 200, String(rate));
    assert.equal((await ctx.json('GET', `${base}/projects/${project.body.id}`)).body.rate, rate);
  }
});

test('the largest accepted rates keep report amounts finite', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  await ctx.json('PUT', base, { default_hourly_rate: 1e9 });
  const capped = await ctx.json('POST', `${base}/projects`, { name: 'Capped', billable: true, rate: 1e9 });
  const inherits = await ctx.json('POST', `${base}/projects`, { name: 'Default rate', billable: true });
  // The longest entry allowed (999 h) on each project.
  for (const project of [capped.body, inherits.body]) {
    await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T00:00:00Z', duration: 999 * 3600, project_id: project.id });
  }
  const totals = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/search/time_entries/totals`, {
    start_date: '2026-10-01', end_date: '2026-10-01',
  });
  assert.equal(totals.status, 200);
  assert.equal(totals.body.billable_amount_in_cents, 2 * 999 * 1e9 * 100);
  assert.ok(Number.isSafeInteger(totals.body.billable_amount_in_cents));
});

// Project and task totals read the partial live-entry indexes.
test('project and task totals use the live-entry indexes and count running, not deleted, entries', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Alpha' });
  const task = await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design' });
  const entries = `${base}/time_entries`;
  await ctx.json('POST', entries, { start: '2026-10-01T08:00:00Z', duration: 3600, task_id: task.body.id });
  const deleted = await ctx.json('POST', entries, { start: '2026-10-01T10:00:00Z', duration: 1800, task_id: task.body.id });
  await ctx.request('DELETE', `${entries}/${deleted.body.id}`);
  const runningSince = Math.floor(Date.now() / 1000) - 120;
  await ctx.json('POST', entries, { start: new Date(runningSince * 1000).toISOString(), duration: -1, task_id: task.body.id });

  // Record the SQL the models run, so the plans below are for the real totals queries.
  const statements: string[] = [];
  const prepare = ctx.db.prepare.bind(ctx.db);
  ctx.db.prepare = (sql: string) => {
    statements.push(sql);
    return prepare(sql);
  };
  const before = Math.floor(Date.now() / 1000);
  const projectRes = await ctx.json('GET', `${base}/projects/${project.body.id}`);
  const taskRes = await ctx.json('GET', `${base}/projects/${project.body.id}/tasks/${task.body.id}`);
  const after = Math.floor(Date.now() / 1000);
  ctx.db.prepare = prepare;

  for (const [actual, scale] of [[projectRes.body.actual_seconds, 1], [taskRes.body.tracked_seconds, 1000]] as const) {
    assert.ok(actual >= (3600 + before - runningSince) * scale && actual <= (3600 + after - runningSince) * scale, String(actual));
  }

  const plan = (fragment: string, params: number[]) => {
    const sql = statements.find((s) => s.includes(fragment));
    assert.ok(sql, `no statement containing ${fragment}`);
    return (prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join('\n');
  };
  assert.match(plan('AS actual_seconds', [ctx.wid, project.body.id]), /time_entries_project_live/);
  assert.match(plan('AS tracked_seconds', [ctx.wid, task.body.id]), /time_entries_task_live/);
});

test('a version 1 database gains the live-entry indexes when opened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-v1-'));
  try {
    const path = join(dir, 'v1.sqlite');
    const v1 = new DatabaseSync(path);
    v1.exec(MIGRATIONS[0]!);
    v1.exec('PRAGMA user_version = 1');
    v1.close();

    const db = openDatabase(path);
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(user_version, MIGRATIONS.length);
    assert.equal(user_version, 5);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'time_entries'").all() as Array<{ name: string }>)
      .map((row) => row.name);
    assert.ok(indexes.includes('time_entries_project_live'), indexes.join());
    assert.ok(indexes.includes('time_entries_task_live'), indexes.join());
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Deleting a client renames colliding projects instead of failing or merging them.
test('deleting a client renames projects whose names collide with unassigned ones', async () => {
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = (body: Record<string, unknown>) => ctx.json('POST', `${base}/projects`, body).then((r) => r.body);
  const client = (name: string) => ctx.json('POST', `${base}/clients`, { name }).then((r) => r.body);
  const nameOf = async (id: number) => (await ctx.json('GET', `${base}/projects/${id}`)).body.name;
  const deleteClient = async (id: number) => assert.equal((await ctx.request('DELETE', `${base}/clients/${id}`)).status, 200);

  const unassigned = await project({ name: 'Website' });
  const acme = await client('ACME');
  const acmeSite = await project({ name: 'website', client_id: acme.id, rate: 120 });
  const entry = await ctx.json('POST', `${base}/time_entries`, { start: '2026-10-01T08:00:00Z', duration: 600, project_id: acmeSite.id });
  await deleteClient(acme.id);
  const renamed = await ctx.json('GET', `${base}/projects/${acmeSite.id}`);
  assert.equal(renamed.body.name, 'website (ACME)');
  assert.equal(renamed.body.client_id, null);
  assert.equal(renamed.body.rate, 120);
  assert.equal(renamed.body.actual_seconds, 600);
  assert.equal((await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`)).body.project_id, acmeSite.id);
  assert.equal(await nameOf(unassigned.id), 'Website');

  // The same client name again: "Website (ACME)" is taken now, so a number is appended.
  const acmeAgain = await client('ACME');
  const second = await project({ name: 'Website', client_id: acmeAgain.id });
  await deleteClient(acmeAgain.id);
  assert.equal(await nameOf(second.id), 'Website (ACME) 2');

  // Two clients with the same project name: the first freed name wins, the second gets a suffix.
  const one = await client('One');
  const two = await client('Two');
  const oneSite = await project({ name: 'Shop', client_id: one.id });
  const twoSite = await project({ name: 'Shop', client_id: two.id });
  await deleteClient(one.id);
  assert.equal(await nameOf(oneSite.id), 'Shop');
  await deleteClient(two.id);
  assert.equal(await nameOf(twoSite.id), 'Shop (Two)');

  // Generated names stay within the 255 character limit.
  const long = 'x'.repeat(255);
  await project({ name: long });
  const big = await client('Big');
  const longSite = await project({ name: long, client_id: big.id });
  await deleteClient(big.id);
  const clipped = await nameOf(longSite.id);
  assert.equal(clipped, `${'x'.repeat(249)} (Big)`);
  assert.equal(clipped.length, 255);

  const all = (await ctx.json('GET', `${base}/projects`)).body;
  assert.equal(all.length, 7);
  assert.ok(all.every((p: any) => p.client_id === null));
});
