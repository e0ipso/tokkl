import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSRF, PASSWORD, setup } from './helpers.ts';
import { reference } from './storageCompatibilitySupport.ts';

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const RANGE = { start_date: '2026-10-01', end_date: '2026-10-31' };

test('HTTP reference preserves accounts, catalog names, ordering, scopes and errors', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const { capture, compare } = reference(ctx);
  const base = `/api/v9/workspaces/${ctx.wid}`;
  await capture('account with related data', 'GET', '/api/v9/me?with_related_data=true');
  await capture('unauthenticated account', 'GET', '/api/v9/me', undefined,
    { status: 403, headers: { authorization: '' } });
  await capture('wrong password', 'POST', '/api/app/login', { email: 'me@example.com', password: 'wrong password' },
    { status: 403, headers: { authorization: '', ...CSRF } });
  const signedIn = await capture('password login', 'POST', '/api/app/login', { email: 'me@example.com', password: PASSWORD },
    { headers: { authorization: '', ...CSRF } });
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]!;
  await capture('cookie authenticated account', 'GET', '/api/v9/me', undefined,
    { headers: { authorization: '', cookie } });
  await capture('cookie write without CSRF', 'POST', '/api/v9/me/preferences', { theme: 'dark' },
    { status: 403, headers: { authorization: '', cookie } });
  await capture('merge preferences', 'POST', '/api/v9/me/preferences', { custom_key: { nested: true }, duration_format: 'decimal' });
  const acme = await capture('ASCII client', 'POST', `${base}/clients`, { name: 'ACME', notes: null });
  await capture('ASCII duplicate client', 'POST', `${base}/clients`, { name: 'acme' }, { status: 400 });
  for (const name of ['Éclair', 'éclair', 'eclair', 'A_%B', 'AXB']) {
    await capture(`client ${name}`, 'POST', `${base}/clients`, { name });
  }
  await capture('trailing spaces are trimmed before uniqueness', 'POST', `${base}/clients`, { name: ' ACME ' }, { status: 400 });
  await capture('ordered clients', 'GET', `${base}/clients?status=both`);
  await capture('literal wildcard client search', 'GET', `${base}/clients?name=${encodeURIComponent('_%')}`);
  await capture('ASCII client search', 'GET', `${base}/clients?name=acm`);
  await capture('accented client search', 'GET', `${base}/clients?name=${encodeURIComponent('é')}`);
  const project = await capture('client project', 'POST', `${base}/projects`, {
    name: 'Shared', client_id: acme.body.id, color: '#123456', billable: true, rate: 42.5, currency: 'eur', estimated_hours: 2,
  });
  await capture('same project name without client', 'POST', `${base}/projects`, { name: 'shared', color: '#654321' });
  await capture('duplicate null-client project', 'POST', `${base}/projects`, { name: 'SHARED' }, { status: 400 });
  await capture('duplicate same-client project', 'POST', `${base}/projects`, { name: 'SHARED', client_id: acme.body.id }, { status: 400 });
  const task = await capture('project task', 'POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design', estimated_seconds: 3600 });
  await capture('task archive', 'PUT', `${base}/projects/${project.body.id}/tasks/${task.body.id}`, { active: false });
  await capture('task listing envelope', 'GET', `${base}/tasks?active=both&per_page=2`);
  await capture('tag zebra', 'POST', `${base}/tags`, { name: 'zebra' });
  await capture('tag alpha', 'POST', `${base}/tags`, { name: 'Alpha' });
  await capture('duplicate tag', 'POST', `${base}/tags`, { name: 'ALPHA' }, { status: 400 });
  await capture('ordered tags', 'GET', `${base}/tags`);
  await capture('invalid hourly rate', 'PUT', `${base}/projects/${project.body.id}`, { rate: -1 }, { status: 400 });
  const archived = await capture('client archive', 'POST', `${base}/clients/${acme.body.id}/archive`, undefined, { idArray: true });
  assert.deepEqual(archived.body, [project.body.id]);
  await capture('archived project', 'GET', `${base}/projects/${project.body.id}`);
  await capture('client and project restore', 'POST', `${base}/clients/${acme.body.id}/restore`, { restore_all_projects: true });
  await capture('delete client empty response', 'DELETE', `${base}/clients/${acme.body.id}`);
  await capture('detached project collision rename', 'GET', `${base}/projects/${project.body.id}`);
  await capture('final catalog related data', 'GET', '/api/v9/me?with_related_data=true');
  compare('catalog');
});

test('HTTP reference preserves entry values, all-day DST anchoring and timer revisions', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const { capture, compare } = reference(ctx);
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Build', color: '#123456', billable: true });
  const task = await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Ship' });
  const stopped = await capture('stopped entry rounds and infers project from task', 'POST', `${base}/time_entries`, {
    description: 'Literal _% and É', start: '2026-10-05T11:01:20.500+02:00', stop: '2026-10-05T12:32:10+02:00',
    task_id: task.body.id, tags: ['zebra', 'Alpha'], created_with: 'storage-reference',
  });
  assert.equal(stopped.body.project_id, project.body.id);
  await capture('entry with metadata and canonical tag order', 'GET', `/api/v9/me/time_entries/${stopped.body.id}?meta=true`);
  const totals = await capture('task tracked time remains milliseconds', 'GET', `${base}/projects/${project.body.id}/tasks`);
  assert.equal(totals.body[0].tracked_seconds, stopped.body.duration * 1000);
  await capture('all-day entry on DST fall-back date', 'POST', `${base}/time_entries`, {
    all_day: true, start_date: '2026-10-25', duration: 5400, description: 'No times', project_id: null,
  });
  await capture('invalid timestamp error', 'POST', `${base}/time_entries`, { start: '2026-02-30T09:00:00Z', duration: 600 }, { status: 400 });
  await capture('missing project error', 'POST', `${base}/time_entries`, {
    start: '2026-10-05T12:00:00Z', duration: 600, project_id: 999999,
  }, { status: 404 });
  await capture('edit stopped entry', 'PUT', `${base}/time_entries/${stopped.body.id}`, { description: 'Renamed _%' });
  await capture('ordered entries with metadata', 'GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-11-01&meta=true');
  await capture('initial timer state', 'GET', '/api/app/timer');
  const running = await capture('running entry', 'POST', `${base}/time_entries`, {
    start: '2026-10-30T11:45:00Z', duration: -1, description: 'Running', task_id: task.body.id,
    tags: ['zebra', 'Alpha'], created_with: 'storage-reference',
  });
  const current = await capture('running timer state', 'GET', '/api/app/timer');
  assert.equal(current.body.running_entry.id, running.body.id);
  t.mock.timers.setTime(NOW + 5 * 60000);
  const paused = await capture('pause timer', 'POST', '/api/app/timer/pause', {});
  assert.ok(paused.body.revision > current.body.revision);
  await capture('stale resume carries current state', 'POST', '/api/app/timer/resume', { revision: current.body.revision }, { status: 409 });
  t.mock.timers.setTime(NOW + 10 * 60000);
  const resumed = await capture('resume timer', 'POST', '/api/app/timer/resume', { revision: paused.body.revision });
  assert.ok(resumed.body.revision > paused.body.revision);
  t.mock.timers.setTime(NOW + 25 * 60000);
  await capture('stop resumed timer', 'PATCH', `${base}/time_entries/${resumed.body.running_entry.id}/stop`);
  await capture('idle timer after stop', 'GET', '/api/app/timer');
  await capture('stop already stopped entry error', 'PATCH', `${base}/time_entries/${resumed.body.running_entry.id}/stop`, undefined, { status: 409 });
  await capture('delete stopped entry empty response', 'DELETE', `${base}/time_entries/${stopped.body.id}`);
  await capture('deleted entry is unavailable', 'GET', `/api/v9/me/time_entries/${stopped.body.id}`, undefined, { status: 404 });
  await capture('trash contains deleted entry', 'GET', '/api/app/trash');
  compare('entries-timer');
});

test('HTTP reference preserves reports and JSON/CSV import and export contents', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const ctx = await setup({ timezone: 'Europe/Madrid' });
  const source = reference(ctx);
  const base = `/api/v9/workspaces/${ctx.wid}`;
  await ctx.json('PUT', base, { default_currency: 'EUR', default_hourly_rate: 50 });
  const client = await ctx.json('POST', `${base}/clients`, { name: 'ACME' });
  const project = await ctx.json('POST', `${base}/projects`, { name: 'Website', client_id: client.body.id, color: '#123456', rate: 80, billable: true });
  const task = await ctx.json('POST', `${base}/projects/${project.body.id}/tasks`, { name: 'Design' });
  await ctx.json('POST', `${base}/time_entries`, {
    start: '2026-10-05T08:00:00Z', duration: 5400, description: 'Homepage, hero', task_id: task.body.id,
    tags: ['zebra', 'Alpha'], created_with: 'storage-reference',
  });
  await ctx.json('POST', `${base}/time_entries`, { all_day: true, start_date: '2026-10-25', duration: 2700, description: 'Planning' });
  await source.capture('app report summary', 'POST', '/api/app/report', { ...RANGE, grouping: 'clients', sub_grouping: 'projects' });
  await source.capture('app report details', 'POST', '/api/app/report/entries', { ...RANGE, page_size: 1, sort: 'date', direction: 'asc' });
  await source.capture('app report weekly', 'POST', '/api/app/report/weekly', { start_date: '2026-10-05', grouping: 'projects' });
  await source.capture('v3 report units and nulls', 'POST', `/reports/api/v3/workspace/${ctx.wid}/search/time_entries`, { ...RANGE, order_dir: 'ASC' });
  await source.capture('literal description filter', 'POST', '/api/app/report/entries', { ...RANGE, description: '%' });
  await source.capture('detailed CSV report', 'POST', '/api/app/report/detailed.csv', RANGE);
  await source.capture('summary CSV report', 'POST', '/api/app/report/summary.csv', RANGE);
  await source.capture('CSV export', 'GET', '/api/app/export.csv?start_date=2026-10-01&end_date=2026-10-31');
  const backup = await source.capture('JSON export', 'GET', '/api/app/export.json');
  assert.ok(!JSON.stringify(backup.body).includes(ctx.user.api_token));
  assert.ok(!JSON.stringify(backup.body).includes('scrypt$'));
  await source.capture('invalid report page size', 'POST', '/api/app/report/entries', { ...RANGE, page_size: 501 }, { status: 400 });
  source.compare('reports-export');

  const restored = await setup({ timezone: 'America/New_York' });
  const json = reference(restored);
  await json.capture('JSON dry run', 'POST', '/api/app/import/json?dry_run=true', backup.body);
  await json.capture('JSON dry run leaves entries empty', 'GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-11-01');
  await json.capture('JSON restore', 'POST', '/api/app/import/json', backup.body);
  await json.capture('JSON restore again skips duplicates', 'POST', '/api/app/import/json', backup.body);
  await json.capture('JSON restored entries in new timezone', 'GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-11-01&meta=true');
  await json.capture('invalid JSON upload', 'POST', '/api/app/import/json', '{', { status: 400 });
  json.compare('json-import');

  const csvTarget = await setup({ timezone: 'Europe/Madrid' });
  const csv = reference(csvTarget);
  const text = [
    'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags',
    'Me,me@example.com,ACME,Website,Design,"Homepage, hero",Yes,2026-10-05,10:01:20,2026-10-05,11:31:40,01:30:20,"zebra, Alpha"',
    'Me,me@example.com,,,,Invalid date,No,not-a-date,08:00:00,,,00:10:00,',
    'Me,me@example.com,,,,No times,No,2026-10-25,,2026-10-25,,00:45:00,',
  ].join('\n');
  const csvHeaders = { 'content-type': 'text/csv' };
  await csv.capture('CSV dry run with invalid middle row', 'POST', '/api/app/import/toggl-csv?dry_run=true', text, { headers: csvHeaders });
  await csv.capture('CSV dry run leaves entries empty', 'GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-11-01');
  await csv.capture('CSV import continues after invalid row', 'POST', '/api/app/import/toggl-csv', text, { headers: csvHeaders });
  await csv.capture('CSV reimport skips duplicates', 'POST', '/api/app/import/toggl-csv', text, { headers: csvHeaders });
  await csv.capture('CSV imported exact times and ordered tags', 'GET', '/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-11-01&meta=true');
  csv.compare('csv-import');
});
