import { insertAccount } from './fixtures/domain.ts';
import { removeWorkspaceMember, completedMigrations } from './fixtures/physical.ts';
import { memberships } from './fixtures/observations.ts';
import { transaction } from './fixtures/database.ts';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { storageFor, filenameFor, setServices } from './fixtures/database.ts';
import { createApp } from '../src/app.ts';
import { generateApiToken, hashPassword } from '../src/auth/crypto.ts';
import { createSession, listWorkspacesForUser } from './fixtures/domain.ts';
import { openDatabase } from './fixtures/database.ts';
import { MIGRATIONS } from './fixtures/legacyMigrations.ts';
import { createFirstAdmin, getUser } from './fixtures/domain.ts';
import {
  addWorkspaceMember, createWorkspace, isWorkspaceMember,
} from './fixtures/domain.ts';
import { addUser, CSRF, PASSWORD, sessionCookie, setup, testConfig, testServer, type TestContext } from './helpers.ts';

/** The schema version shipped before roles and workspace membership. */
const PREVIOUS_VERSION = 2;
const NOW = '2026-10-01T08:00:00.000Z';

test('SQLite legacy schema version 2 is refused without modifying its data', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tokkl-refusal-')); const path=join(dir,'legacy.sqlite');
 try { const old=new DatabaseSync(path); old.function('canonical_time_zone',{deterministic:true},value=>value); for(const migration of MIGRATIONS.slice(0,2))old.exec(migration); old.exec('PRAGMA user_version=2'); old.close();
 const before=readFileSync(path); await assert.rejects(openDatabase(path),/unsupported-schema/); assert.deepEqual(readFileSync(path),before);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('SQLite legacy schema version 2 is refused without modifying its data', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tokkl-refusal-')); const path=join(dir,'legacy.sqlite');
 try { const old=new DatabaseSync(path); old.function('canonical_time_zone',{deterministic:true},value=>value); for(const migration of MIGRATIONS.slice(0,2))old.exec(migration); old.exec('PRAGMA user_version=2'); old.close();
 const before=readFileSync(path); await assert.rejects(openDatabase(path),/unsupported-schema/); assert.deepEqual(readFileSync(path),before);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a fresh database has no memberships until setup creates the first admin, who owns its workspace', async () => {
  const db = (await openDatabase());
  assert.equal(await completedMigrations(db),3);
  assert.deepEqual((await memberships(db)), []);

  const app = testServer(createApp({ storage: storageFor(db), config: testConfig(db), setup: { code: 'ABCD-EFGH-JKLM' } }));
  const response = await app.request('/api/app/setup', {
    method: 'POST',
    headers: { ...CSRF, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: PASSWORD, fullname: 'Owner', setup_code: 'ABCD-EFGH-JKLM' }),
  });
  assert.equal(response.status, 200);
  const user = (await storageFor(db).users.list())[0]!;
  assert.equal(user.role, 'admin');
  assert.deepEqual((await memberships(db)), [{ workspace_id: user.defaultWorkspaceId, user_id: user.id, role: 'owner' }]);
});

test('createFirstAdmin makes an admin who owns the new workspace', async () => {
  const db = (await openDatabase());
  const user = (await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' }));
  assert.equal(user.role, 'admin');
  assert.equal(user.disabledAt, null);
  assert.deepEqual((await memberships(db)), [{ workspace_id: user.defaultWorkspaceId, user_id: user.id, role: 'owner' }]);
  assert.deepEqual((await listWorkspacesForUser(db, user.id)).map((ws) => ws.id), [user.defaultWorkspaceId]);
});

test('isWorkspaceMember and listWorkspacesForUser see only the workspaces a user belongs to', async () => {
  const db = (await openDatabase());
  const owner = (await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' }));
  const shared = (await createWorkspace(db, 'Shared')).id;
  const memberId = (await insertAccount(db,{email:'member@example.com',fullname:'',passwordHash:'x',timezone:'UTC',role:'user'})).id;
  const memberOwn = (await storageFor(db).users.get(memberId))!.defaultWorkspaceId;
  await removeWorkspaceMember(db,memberOwn,memberId);
  (await addWorkspaceMember(db, shared, memberId, 'member'));
  const outsiderId = (await insertAccount(db,{email:'outsider@example.com',fullname:'',passwordHash:'x',timezone:'UTC',role:'user'})).id;
  const outsiderOwn = (await storageFor(db).users.get(outsiderId))!.defaultWorkspaceId;
  await removeWorkspaceMember(db,outsiderOwn,outsiderId);

  assert.equal((await isWorkspaceMember(db, owner.id, owner.defaultWorkspaceId)), true);
  assert.equal((await isWorkspaceMember(db, owner.id, shared)), false);
  assert.equal((await isWorkspaceMember(db, memberId, shared)), true);
  assert.equal((await isWorkspaceMember(db, memberId, owner.defaultWorkspaceId)), false);
  assert.equal((await isWorkspaceMember(db, outsiderId, shared)), false);

  assert.deepEqual((await listWorkspacesForUser(db, owner.id)).map((ws) => ws.id), [owner.defaultWorkspaceId]);
  assert.deepEqual((await listWorkspacesForUser(db, memberId)).map((ws) => ws.name), ['Shared']);
  assert.deepEqual((await listWorkspacesForUser(db, outsiderId)), []);
  assert.equal((await getUser(db, memberId))!.role, 'user');
});

test('addUser signs a second account in on the same app with its own workspace', async () => {
  const first = (await setup());
  const second = (await addUser(first, { email: 'second@example.com', role: 'user' }));
  const admin = (await addUser(first, { email: 'admin@example.com', role: 'admin' }));

  assert.equal(second.db, first.db);
  assert.deepEqual([first.user.role, second.user.role, admin.user.role], ['admin', 'user', 'admin']);
  assert.equal(new Set([first.wid, second.wid, admin.wid]).size, 3, 'each account has its own workspace');
  assert.deepEqual((await memberships(first.db)).filter((row) => row.user_id !== first.user.id), [
    { workspace_id: second.wid, user_id: second.user.id, role: 'owner' },
    { workspace_id: admin.wid, user_id: admin.user.id, role: 'owner' },
  ]);

  for (const ctx of [first, second, admin]) {
    const byToken = await ctx.json('GET', '/api/v9/me');
    assert.equal(byToken.status, 200);
    assert.equal(byToken.body.id, ctx.user.id);
    assert.equal(byToken.body.default_workspace_id, ctx.wid);

    const cookie = (await sessionCookie(ctx));
    const byCookie = await first.request('GET', '/api/v9/me', undefined, { authorization: '', cookie });
    assert.equal(byCookie.status, 200);
    const me = await byCookie.json() as { email: string; default_workspace_id: number };
    assert.equal(me.email, ctx.user.email);
    assert.equal(me.default_workspace_id, ctx.wid);
  }
});

const ORGANIZATION_FIELDS = [
  'id', 'name', 'pricing_plan_id', 'pricing_plan_name', 'created_at', 'at', 'server_deleted_at', 'is_multi_workspace_enabled',
  'suspended_at', 'user_count', 'trial_info', 'is_chargify', 'is_unified', 'max_workspaces', 'admin', 'owner', 'permissions',
];
const MEMBER_FIELDS = ['id', 'email', 'fullname', 'timezone', 'admin', 'inactive'];

test('workspace and organization flags come from the caller\'s membership, not users.role', async () => {
  const owner = (await setup());
  // An instance admin who joins as a member is not a workspace admin; a plain user who owns a workspace is.
  const member = (await addUser(owner, { email: 'member@example.com', role: 'admin', fullname: 'Member' }));
  const outsider = (await addUser(owner, { email: 'outsider@example.com', role: 'user' }));
  (await addWorkspaceMember(owner.db, owner.wid, member.user.id, 'member'));

  const ownerOrgs = await owner.json('GET', '/api/v9/me/organizations');
  assert.equal(ownerOrgs.status, 200);
  assert.deepEqual(ownerOrgs.body.map((org: any) => [org.id, org.admin, org.owner, org.user_count]), [[owner.wid, true, true, 2]]);
  assert.deepEqual(Object.keys(ownerOrgs.body[0]), ORGANIZATION_FIELDS);

  const memberOrgs = await member.json('GET', '/api/v9/me/organizations');
  assert.deepEqual(memberOrgs.body.map((org: any) => [org.id, org.admin, org.owner, org.user_count]),
    [[owner.wid, false, false, 2], [member.wid, true, true, 1]]);
  const outsiderOrgs = await outsider.json('GET', '/api/v9/me/organizations');
  assert.deepEqual(outsiderOrgs.body.map((org: any) => [org.id, org.admin, org.owner, org.user_count]), [[outsider.wid, true, true, 1]],
    'a plain user owns its workspace and does not see the others');

  const flags = (body: any) => ({ admin: body.admin, role: body.role });
  assert.deepEqual(flags((await owner.json('GET', `/api/v9/workspaces/${owner.wid}`)).body), { admin: true, role: 'admin' });
  assert.deepEqual(flags((await member.json('GET', `/api/v9/workspaces/${owner.wid}`)).body), { admin: false, role: 'user' });
  assert.deepEqual(flags((await outsider.json('GET', `/api/v9/workspaces/${outsider.wid}`)).body), { admin: true, role: 'admin' });
  assert.deepEqual(flags((await owner.json('PUT', `/api/v9/workspaces/${owner.wid}`, { name: 'Renamed' })).body),
    { admin: true, role: 'admin' });
  const related = await member.json('GET', '/api/v9/me?with_related_data=true');
  assert.deepEqual(related.body.workspaces.map((ws: any) => [ws.id, ws.admin, ws.role]),
    [[owner.wid, false, 'user'], [member.wid, true, 'admin']]);
  const exported = await member.json('GET', '/api/app/export.json');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.workspaces.find((ws: any) => ws.id === owner.wid).admin, false);
});

test('GET /workspaces/:wid/users lists the workspace members and refuses non-members', async () => {
  const owner = (await setup());
  const member = (await addUser(owner, { email: 'member@example.com', role: 'admin', fullname: 'Member', timezone: 'Europe/Madrid' }));
  const outsider = (await addUser(owner, { email: 'outsider@example.com', role: 'user' }));
  (await addWorkspaceMember(owner.db, owner.wid, member.user.id, 'member'));

  for (const ctx of [owner, member]) {
    const users = await ctx.json('GET', `/api/v9/workspaces/${owner.wid}/users`);
    assert.equal(users.status, 200);
    assert.deepEqual(users.body, [
      { id: owner.user.id, email: 'me@example.com', fullname: 'Test User', timezone: 'UTC', admin: true, inactive: false },
      { id: member.user.id, email: 'member@example.com', fullname: 'Member', timezone: 'Europe/Madrid', admin: false, inactive: false },
    ]);
    assert.deepEqual(Object.keys(users.body[0]!), MEMBER_FIELDS);
  }

  for (const wid of [owner.wid, 999]) {
    const refused = await outsider.json('GET', `/api/v9/workspaces/${wid}/users`);
    assert.equal(refused.status, 403);
    assert.equal(refused.body, 'User does not have access to this resource.');
  }
  const own = await outsider.json('GET', `/api/v9/workspaces/${outsider.wid}/users`);
  assert.deepEqual(own.body.map((user: any) => [user.email, user.admin]), [['outsider@example.com', true]]);
});

/** A's catalog and entries as A sees them, to show that B's refused requests changed nothing. */
async function workspaceState(ctx: TestContext) {
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const read = async (path: string) => (await ctx.json('GET', path)).body;
  return {
    workspace: (await read(base)),
    projects: (await read(`${base}/projects`)),
    tasks: (await read(`${base}/tasks`)),
    clients: (await read(`${base}/clients`)),
    tags: (await read(`${base}/tags`)),
    entries: (await read('/api/v9/me/time_entries?start_date=2026-01-01&end_date=2027-01-01')),
  };
}

/**
 * Gives `ctx` a client, a project, a task, a tag and one stopped entry using all of them. Each name
 * starts with `prefix`, so two accounts' records can be told apart.
 */
async function seedWorkspace(ctx: TestContext, prefix = '') {
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const client = (await ctx.json('POST', `${base}/clients`, { name: `${prefix}Client` })).body;
  const project = (await ctx.json('POST', `${base}/projects`, { name: `${prefix}Project`, client_id: client.id })).body;
  const task = (await ctx.json('POST', `${base}/projects/${project.id}/tasks`, { name: `${prefix}Task` })).body;
  const tag = (await ctx.json('POST', `${base}/tags`, { name: `${prefix}Tag` })).body;
  const entry = (await ctx.json('POST', `${base}/time_entries`, {
    start: '2026-10-01T08:00:00Z', duration: 3600, project_id: project.id, task_id: task.id, tags: [`${prefix}Tag`], workspace_id: ctx.wid,
  })).body;
  for (const created of [client, project, task, tag, entry]) assert.equal(typeof created.id, 'number');
  return { client, project, task, tag, entry };
}

test('a non-member gets 403 from every route under another account\'s workspace and changes nothing', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  const { client, project, task, tag, entry } = (await seedWorkspace(a));
  const before = (await workspaceState(a));

  const ws = `/api/v9/workspaces/${a.wid}`;
  const reports = `/reports/api/v3/workspace/${a.wid}`;
  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };
  const routes: Array<[string, string, unknown?]> = [
    ['GET', ws], ['PUT', ws, { name: 'Taken' }], ['GET', `${ws}/users`],
    ['POST', `${ws}/time_entries`, { start: '2026-10-02T08:00:00Z', duration: 600, workspace_id: a.wid }],
    ['PUT', `${ws}/time_entries/${entry.id}`, { description: 'Taken' }],
    ['PATCH', `${ws}/time_entries/${entry.id}/stop`],
    ['PATCH', `${ws}/time_entries/${entry.id}`, [{ op: 'replace', path: '/description', value: 'Taken' }]],
    ['DELETE', `${ws}/time_entries/${entry.id}`],
    ['GET', `${ws}/projects`], ['GET', `${ws}/projects/${project.id}`], ['POST', `${ws}/projects`, { name: 'Taken' }],
    ['PUT', `${ws}/projects/${project.id}`, { name: 'Taken' }],
    ['DELETE', `${ws}/projects/${project.id}?teDeletionMode=delete`],
    ['GET', `${ws}/tasks`], ['GET', `${ws}/projects/${project.id}/tasks`], ['GET', `${ws}/projects/${project.id}/tasks/${task.id}`],
    ['POST', `${ws}/projects/${project.id}/tasks`, { name: 'Taken' }],
    ['PUT', `${ws}/projects/${project.id}/tasks/${task.id}`, { name: 'Taken' }],
    ['DELETE', `${ws}/projects/${project.id}/tasks/${task.id}`],
    ['GET', `${ws}/clients`], ['GET', `${ws}/clients/${client.id}`], ['POST', `${ws}/clients`, { name: 'Taken' }],
    ['PUT', `${ws}/clients/${client.id}`, { name: 'Taken' }], ['POST', `${ws}/clients/${client.id}/archive`],
    ['POST', `${ws}/clients/${client.id}/restore`, {}], ['DELETE', `${ws}/clients/${client.id}`],
    ['GET', `${ws}/tags`], ['POST', `${ws}/tags`, { name: 'Taken' }], ['PUT', `${ws}/tags/${tag.id}`, { name: 'Taken' }],
    ['DELETE', `${ws}/tags/${tag.id}`],
    ['POST', `${reports}/search/time_entries`, range], ['POST', `${reports}/search/time_entries/totals`, range],
    ['POST', `${reports}/search/time_entries.csv`, range], ['POST', `${reports}/summary/time_entries`, range],
    ['POST', `${reports}/summary/time_entries.csv`, range], ['POST', `${reports}/weekly/time_entries`, { start_date: '2026-10-01' }],
  ];
  for (const [method, path, body] of routes) {
    const response = await b.json(method, path, body);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(response.body, 'User does not have access to this resource.', `${method} ${path}`);
  }
  for (const path of ['/api/v9/workspaces/999/projects', '/api/v9/workspaces/999/users']) {
    assert.equal((await b.json('GET', path)).status, 403, `${path}: a missing workspace looks the same as someone else's`);
  }
  assert.deepEqual((await workspaceState(a)), before, 'A\'s workspace, catalog and entries are untouched');

  assert.equal((await a.json('GET', `${ws}/projects`)).status, 200, 'the owner still reaches its own workspace');
  assert.equal((await a.json('POST', `${reports}/search/time_entries/totals`, range)).status, 200);
  assert.equal((await b.json('GET', `/api/v9/workspaces/${b.wid}/projects`)).status, 200, 'B still reaches its own workspace');
});

test('a member reaches a shared workspace through the same routes', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  (await addWorkspaceMember(a.db, a.wid, b.user.id, 'member'));
  const project = await b.json('POST', `/api/v9/workspaces/${a.wid}/projects`, { name: 'Shared' });
  assert.equal(project.status, 200);
  const entry = await b.json('POST', `/api/v9/workspaces/${a.wid}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 300, project_id: project.body.id, workspace_id: a.wid });
  assert.equal(entry.status, 200);
  const totals = await b.json('POST', `/reports/api/v3/workspace/${a.wid}/search/time_entries/totals`,
    { start_date: '2026-10-01', end_date: '2026-10-07' });
  assert.equal(totals.status, 200);
  assert.equal(totals.body.seconds, 300);
});

test('PUT /me accepts only a default workspace the caller belongs to, and app reports follow that rule', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  (await seedWorkspace(a));
  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };

  for (const wid of [a.wid, 999]) {
    const refused = await b.json('PUT', '/api/v9/me', { default_workspace_id: wid, fullname: 'Renamed' });
    assert.equal(refused.status, 400, `default_workspace_id ${wid}`);
    assert.equal(refused.body, 'Invalid default_workspace_id');
    const stored = (await getUser(b.db, b.user.id))!;
    assert.equal(stored.defaultWorkspaceId, b.wid, 'B\'s default workspace is unchanged');
    assert.equal(stored.fullName, '', 'nothing else is written either');
  }
  const own = await b.json('POST', '/api/app/report', range);
  assert.equal(own.status, 200);
  assert.equal(own.body.totals.entry_count, 0, 'B\'s report holds none of A\'s entries');

  // A member may make the shared workspace its default; once the membership ends, the app reports refuse it.
  (await addWorkspaceMember(a.db, a.wid, b.user.id, 'member'));
  const joined = await b.json('PUT', '/api/v9/me', { default_workspace_id: a.wid });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.default_workspace_id, a.wid);
  assert.equal((await b.json('POST', '/api/app/report', range)).status, 200);
  await removeWorkspaceMember(a.db, a.wid, b.user.id);
  for (const path of ['/api/app/report', '/api/app/report/weekly', '/api/app/report/entries', '/api/app/report/detailed.csv',
    '/api/app/report/summary.csv']) {
    const refused = await b.json('POST', path, range);
    assert.equal(refused.status, 403, path);
    assert.equal(refused.body, 'User does not have access to this resource.', path);
  }
});

test('trash restore needs membership of the entry\'s workspace', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  (await addWorkspaceMember(a.db, a.wid, b.user.id, 'member'));
  const ws = `/api/v9/workspaces/${a.wid}`;
  const created = async () => (await b.json('POST', `${ws}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 600, workspace_id: a.wid })).body.id as number;
  const kept = (await created());
  const left = (await created());
  for (const id of [kept, left]) assert.equal((await b.json('DELETE', `${ws}/time_entries/${id}`)).status, 200);

  const restored = await b.json('POST', `/api/app/time_entries/${kept}/restore`);
  assert.equal(restored.status, 200, 'a member restores its entry');
  assert.equal(restored.body.id, kept);

  await removeWorkspaceMember(a.db, a.wid, b.user.id);
  const refused = await b.json('POST', `/api/app/time_entries/${left}/restore`);
  assert.equal(refused.status, 403);
  assert.equal(refused.body, 'User does not have access to this resource.');
  const row = {deleted_at:(await storageFor(a.db).entries.get(b.user.id,left,true))!.deletedAt};
  assert.notEqual(row.deleted_at, null, 'the entry stays in the trash');
});

test('a non-member cannot delete another workspace\'s project or trash its entries', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  const { project, entry } = (await seedWorkspace(a));
  const refused = await b.json('DELETE', `/api/v9/workspaces/${a.wid}/projects/${project.id}?teDeletionMode=delete`);
  assert.equal(refused.status, 403);
  assert.equal((await a.json('GET', `/api/v9/workspaces/${a.wid}/projects/${project.id}`)).status, 200, 'the project is still there');
  const kept = await a.json('GET', `/api/v9/me/time_entries/${entry.id}`);
  assert.equal(kept.status, 200, 'the entry is not in the trash');
  assert.equal(kept.body.project_id, project.id);
});

/** What `ctx` sees through each /me collection: workspace ids, and record names per collection. */
async function meCollections(ctx: TestContext) {
  const names = (list: Array<{ name: string }>) => list.map((item) => item.name).sort();
  const related = (await ctx.json('GET', '/api/v9/me?with_related_data=true')).body;
  return {
    related: {
      workspaces: related.workspaces.map((ws: any) => ws.id),
      clients: names(related.clients), projects: names(related.projects), tasks: names(related.tasks), tags: names(related.tags),
    },
    workspaces: (await ctx.json('GET', '/api/v9/me/workspaces')).body.map((ws: any) => ws.id),
    features: (await ctx.json('GET', '/api/v9/me/features')).body.map((f: any) => f.workspace_id),
    clients: names((await ctx.json('GET', '/api/v9/me/clients')).body),
    projects: names((await ctx.json('GET', '/api/v9/me/projects')).body),
    tasks: names((await ctx.json('GET', '/api/v9/me/tasks')).body),
    tags: names((await ctx.json('GET', '/api/v9/me/tags')).body),
  };
}

/** The collections a caller should see when it belongs to `wids` holding records named with `prefixes`. */
function expectedCollections(wids: number[], prefixes: string[]) {
  const names = (kind: string) => prefixes.map((prefix) => `${prefix}${kind}`).sort();
  const catalog = { clients: names('Client'), projects: names('Project'), tasks: names('Task'), tags: names('Tag') };
  return { related: { workspaces: wids, ...catalog }, workspaces: wids, features: wids, ...catalog };
}

test('the /me collections hold only the caller\'s workspaces and their catalogs', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  (await seedWorkspace(a, 'A '));
  (await seedWorkspace(b, 'B '));

  assert.deepEqual((await meCollections(a)), expectedCollections([a.wid], ['A ']));
  assert.deepEqual((await meCollections(b)), expectedCollections([b.wid], ['B ']));

  (await addWorkspaceMember(a.db, a.wid, b.user.id, 'member'));
  assert.deepEqual((await meCollections(b)), expectedCollections([a.wid, b.wid], ['A ', 'B ']), 'a member also sees the shared workspace');
  assert.deepEqual((await meCollections(a)), expectedCollections([a.wid], ['A ']), 'joining does not show B\'s workspace to A');
});

test('the JSON export holds only the caller\'s workspaces and catalog, no secrets, and still restores', async () => {
  const a = (await setup());
  const b = (await addUser(a, { email: 'b@example.com', role: 'user' }));
  (await seedWorkspace(a, 'A '));
  (await seedWorkspace(b, 'B '));

  for (const [ctx, prefix, other] of [[a, 'A ', b], [b, 'B ', a]] as const) {
    const response = await ctx.request('GET', '/api/app/export.json');
    assert.equal(response.status, 200);
    const text = await response.text();
    const exported = JSON.parse(text);
    const names = (list: Array<{ name: string }>) => list.map((item) => item.name);
    assert.deepEqual(exported.workspaces.map((ws: any) => ws.id), [ctx.wid], ctx.user.email);
    assert.deepEqual([names(exported.clients), names(exported.projects), names(exported.tasks), names(exported.tags)],
      [[`${prefix}Client`], [`${prefix}Project`], [`${prefix}Task`], [`${prefix}Tag`]], ctx.user.email);
    assert.deepEqual(exported.time_entries.map((te: any) => te.workspace_id), [ctx.wid]);
    for (const user of [ctx.user, other.user]) {
      assert.ok(!text.includes(user.apiToken), 'no API token');
      assert.ok(!text.includes(user.passwordHash), 'no password hash');
    }
    assert.ok(!text.includes('scrypt$'));

    const target = (await setup());
    const restored = await (await target.request('POST', '/api/app/import/json', text)).json() as any;
    assert.deepEqual(restored.errors, []);
    assert.deepEqual([restored.clients, restored.projects, restored.tasks, restored.tags, restored.time_entries], [1, 1, 1, 1, 1]);
    const restoredProjects = (await target.json('GET', '/api/v9/me/projects')).body;
    assert.deepEqual(restoredProjects.map((p: any) => [p.name, p.client_name]), [[`${prefix}Project`, `${prefix}Client`]]);
    const again = await (await target.request('POST', '/api/app/import/json', text)).json() as any;
    assert.deepEqual([again.time_entries, again.skipped_duplicates], [0, 1], 'restoring twice changes nothing');
  }
});
