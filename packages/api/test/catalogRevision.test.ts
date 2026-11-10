import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUser, setup, type TestContext } from './helpers.ts';
import { addWorkspaceMember } from './fixtures/domain.ts';

const catalog = (wid: number) => `/api/app/workspaces/${wid}/catalog`;

async function revision(ctx: TestContext, wid = ctx.wid): Promise<number> {
  const reply = await ctx.json('GET', catalog(wid));
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual(Object.keys(reply.body), ['revision']);
  assert.ok(Number.isSafeInteger(reply.body.revision));
  return reply.body.revision;
}

async function ok(ctx: TestContext, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await ctx.request(method, path, body, headers);
  const text = await response.text();
  assert.equal(response.status, 200, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const CSV = [
  'User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (EUR)',
  'Me,me@example.com,Imported client,Imported project,,Work,No,2026-09-01,09:00:00,2026-09-01,10:00:00,01:00:00,,',
].join('\n');

interface Fixture {
  ctx: TestContext;
  ws: string;
  clientId: number;
  projectId: number;
}

/** Each write that changes what `GET /workspaces/{wid}/projects` answers, apart from totals. */
const WRITES: Record<string, (f: Fixture) => Promise<unknown>> = {
  'project create': f => ok(f.ctx, 'POST', `${f.ws}/projects`, { name: 'Created' }),
  'project rename': f => ok(f.ctx, 'PUT', `${f.ws}/projects/${f.projectId}`, { name: 'Renamed project' }),
  'project archive': f => ok(f.ctx, 'PUT', `${f.ws}/projects/${f.projectId}`, { active: false }),
  'project restore': async f => {
    await ok(f.ctx, 'PUT', `${f.ws}/projects/${f.projectId}`, { active: false });
    const before = await revision(f.ctx);
    await ok(f.ctx, 'PUT', `${f.ws}/projects/${f.projectId}`, { active: true });
    assert.equal(await revision(f.ctx), before + 1);
  },
  'project delete': f => ok(f.ctx, 'DELETE', `${f.ws}/projects/${f.projectId}`),
  'client create': f => ok(f.ctx, 'POST', `${f.ws}/clients`, { name: 'New client' }),
  'client rename': f => ok(f.ctx, 'PUT', `${f.ws}/clients/${f.clientId}`, { name: 'Renamed client' }),
  'client archive': f => ok(f.ctx, 'POST', `${f.ws}/clients/${f.clientId}/archive`),
  'client restore': async f => {
    await ok(f.ctx, 'POST', `${f.ws}/clients/${f.clientId}/archive`);
    const before = await revision(f.ctx);
    await ok(f.ctx, 'POST', `${f.ws}/clients/${f.clientId}/restore`, { restore_all_projects: true });
    assert.ok((await revision(f.ctx)) > before);
  },
  'client delete': f => ok(f.ctx, 'DELETE', `${f.ws}/clients/${f.clientId}`),
  'default currency change': f => ok(f.ctx, 'PUT', f.ws, { default_currency: 'USD' }),
  'CSV import creating a client and project': f =>
    ok(f.ctx, 'POST', '/api/app/import/toggl-csv', CSV, { 'content-type': 'text/csv' }),
  'JSON restore creating projects': async f => {
    const source = await addUser(f.ctx, { email: 'source@example.com', role: 'user' });
    const sourceWs = `/api/v9/workspaces/${source.wid}`;
    const client = await ok(source, 'POST', `${sourceWs}/clients`, { name: 'Elsewhere' });
    await ok(source, 'POST', `${sourceWs}/projects`, { name: 'Restored', client_id: client.id });
    const exported = await ok(source, 'GET', '/api/app/export.json');
    const restored = await ok(f.ctx, 'POST', '/api/app/import/json', exported);
    assert.equal(restored.projects, 1, JSON.stringify(restored));
  },
};

async function fixture(): Promise<Fixture> {
  const ctx = await setup();
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const client = await ok(ctx, 'POST', `${ws}/clients`, { name: 'Client' });
  const project = await ok(ctx, 'POST', `${ws}/projects`, { name: 'Project', client_id: client.id });
  return { ctx, ws, clientId: client.id, projectId: project.id };
}

for (const [name, write] of Object.entries(WRITES))
  test(`the catalog revision moves on a ${name}`, async () => {
    const f = await fixture();
    const before = await revision(f.ctx);
    await write(f);
    assert.ok((await revision(f.ctx)) > before, `${name} moved the revision`);
  });

test('the catalog revision starts at 0 and stays put on reads, entry and task writes and other settings', async () => {
  const ctx = await setup();
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  assert.equal(await revision(ctx), 0);
  const project = await ok(ctx, 'POST', `${ws}/projects`, { name: 'Project' });
  assert.equal(await revision(ctx), 1);

  await ok(ctx, 'GET', `${ws}/projects`);
  await ok(ctx, 'GET', `${ws}/clients`);
  await ok(ctx, 'POST', `${ws}/time_entries`, {
    start: '2026-10-14T09:00:00Z',
    duration: 600,
    project_id: project.id,
    workspace_id: ctx.wid,
  });
  await ok(ctx, 'POST', `${ws}/projects/${project.id}/tasks`, { name: 'Task' });
  await ok(ctx, 'POST', `${ws}/tags`, { name: 'tag' });
  await ok(ctx, 'PUT', ws, { name: 'Renamed workspace', default_currency: 'EUR', rounding: 1 });
  await ok(ctx, 'POST', '/api/app/import/toggl-csv?dry_run=true', CSV, { 'content-type': 'text/csv' });
  assert.equal(await revision(ctx), 1, 'none of these changes the project list');

  assert.equal((await ctx.request('POST', `${ws}/projects`, { name: 'Project' })).status, 400);
  assert.equal(await revision(ctx), 1);
});

test('each workspace has its own catalog revision, and only members read it', async () => {
  const owner = await setup();
  const member = await addUser(owner, { email: 'member@example.com', role: 'user' });
  const outsider = await addUser(owner, { email: 'outsider@example.com', role: 'admin' });
  await addWorkspaceMember(owner.db, owner.wid, member.user.id, 'member');

  await ok(owner, 'POST', `/api/v9/workspaces/${owner.wid}/projects`, { name: 'Shared project' });
  assert.equal(await revision(owner), 1);
  assert.equal(await revision(member, owner.wid), 1, 'a member reads the shared workspace');
  assert.equal(await revision(member), 0, 'and its own is untouched');

  const refused = await outsider.json('GET', catalog(owner.wid));
  assert.equal(refused.status, 403);
  assert.equal(refused.body, 'User does not have access to this resource.');
  assert.equal((await outsider.json('GET', catalog(999_999))).status, 403, 'a missing workspace looks the same');
  const anonymous = await owner.request('GET', catalog(owner.wid), undefined, { authorization: '' });
  assert.equal(anonymous.status, 403);
});
