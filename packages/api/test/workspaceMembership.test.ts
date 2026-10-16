import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import { generateApiToken, hashPassword } from '../src/auth/crypto.ts';
import { createSession } from '../src/auth/sessions.ts';
import { openDatabase } from '../src/db/index.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';
import { createFirstAdmin, getUser } from '../src/models/users.ts';
import {
  addWorkspaceMember, createWorkspace, isWorkspaceMember, listWorkspacesForUser,
} from '../src/models/workspaces.ts';
import { addUser, PASSWORD, sessionCookie, setup, testConfig, testServer, type TestContext } from './helpers.ts';

/** The schema version shipped before roles and workspace membership. */
const PREVIOUS_VERSION = 2;
const NOW = '2026-10-01T08:00:00.000Z';

const memberships = (db: DatabaseSync) =>
  db.prepare('SELECT workspace_id, user_id, role FROM workspace_users ORDER BY workspace_id, user_id').all()
    .map((row) => ({ ...row }));

/** Runs `fn` with a database file at PREVIOUS_VERSION, removed afterwards. */
async function withPreviousVersion(fn: (path: string, old: DatabaseSync) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-membership-'));
  try {
    const path = join(dir, 'tokkl.db');
    const old = new DatabaseSync(path);
    old.exec('PRAGMA foreign_keys = ON');
    for (const sql of MIGRATIONS.slice(0, PREVIOUS_VERSION)) old.exec(sql);
    old.exec(`PRAGMA user_version = ${PREVIOUS_VERSION}`);
    await fn(path, old);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertWorkspace(db: DatabaseSync, name: string): number {
  return Number(db.prepare('INSERT INTO workspaces (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, NOW, NOW).lastInsertRowid);
}

function insertUser(db: DatabaseSync, user: { id?: number; email: string; passwordHash: string; apiToken: string; wid: number }): number {
  return Number(db.prepare(`
    INSERT INTO users (id, email, password_hash, api_token, default_workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id ?? null, user.email, user.passwordHash, user.apiToken, user.wid, NOW, NOW).lastInsertRowid);
}

test('upgrading a single-user database makes the user admin and owner, and keeps sign-ins and entries', async () => {
  await withPreviousVersion(async (path, old) => {
    const wid = insertWorkspace(old, 'Mine');
    const apiToken = generateApiToken();
    const userId = insertUser(old, { email: 'me@example.com', passwordHash: await hashPassword(PASSWORD), apiToken, wid });
    const orphanWid = insertWorkspace(old, 'Created without an owner');
    const entry = old.prepare(`
      INSERT INTO time_entries (workspace_id, user_id, description, start, stop, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    entry.run(wid, userId, 'Before the upgrade', '2026-10-01T08:00:00.000Z', '2026-10-01T09:00:00.000Z', NOW, NOW);
    entry.run(orphanWid, userId, 'In the ownerless workspace', '2026-10-01T10:00:00.000Z', '2026-10-01T10:30:00.000Z', NOW, NOW);
    const { token: session } = createSession(old, userId, 30, 'test');
    const entriesBefore = old.prepare('SELECT * FROM time_entries ORDER BY id').all();
    old.close();

    const db = openDatabase(path);
    try {
      assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, MIGRATIONS.length);
      const user = getUser(db, userId)!;
      assert.equal(user.role, 'admin');
      assert.equal(user.disabled_at, null);
      assert.deepEqual(memberships(db), [
        { workspace_id: wid, user_id: userId, role: 'owner' },
        { workspace_id: orphanWid, user_id: userId, role: 'owner' },
      ]);
      assert.deepEqual(db.prepare('SELECT * FROM time_entries ORDER BY id').all(), entriesBefore);

      const app = testServer(createApp({ db, config: testConfig(), setup: { code: null } }));
      const byCookie = await app.request('/api/v9/me', { headers: { cookie: `tokkl_session=${session}` } });
      assert.equal(byCookie.status, 200);
      assert.equal(((await byCookie.json()) as { id: number }).id, userId);
      const byToken = await app.request('/api/v9/me/time_entries?start_date=2026-10-01&end_date=2026-10-02', {
        headers: { authorization: `Basic ${Buffer.from(`${apiToken}:api_token`).toString('base64')}` },
      });
      assert.equal(byToken.status, 200);
      assert.deepEqual(((await byToken.json()) as Array<{ description: string }>).map((e) => e.description).sort(),
        ['Before the upgrade', 'In the ownerless workspace']);
    } finally {
      db.close();
    }
  });
});

test('the upgrade gives every workspace to the lowest-id user', async () => {
  await withPreviousVersion(async (path, old) => {
    const first = insertWorkspace(old, 'First');
    const second = insertWorkspace(old, 'Second');
    insertUser(old, { id: 7, email: 'later@example.com', passwordHash: 'x', apiToken: generateApiToken(), wid: second });
    insertUser(old, { id: 3, email: 'earlier@example.com', passwordHash: 'x', apiToken: generateApiToken(), wid: first });
    old.close();

    const db = openDatabase(path);
    try {
      assert.deepEqual(memberships(db), [
        { workspace_id: first, user_id: 3, role: 'owner' },
        { workspace_id: second, user_id: 3, role: 'owner' },
      ]);
      assert.deepEqual(db.prepare('SELECT id, role FROM users ORDER BY id').all().map((row) => ({ ...row })),
        [{ id: 3, role: 'admin' }, { id: 7, role: 'admin' }]);
    } finally {
      db.close();
    }
  });
});

test('a fresh database has no memberships until setup creates the first admin, who owns its workspace', async () => {
  const db = openDatabase(':memory:');
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, MIGRATIONS.length);
  assert.deepEqual(memberships(db), []);

  const app = testServer(createApp({ db, config: testConfig(), setup: { code: 'ABCD-EFGH-JKLM' } }));
  const response = await app.request('/api/app/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: PASSWORD, fullname: 'Owner', setup_code: 'ABCD-EFGH-JKLM' }),
  });
  assert.equal(response.status, 200);
  const user = db.prepare('SELECT id, default_workspace_id, role FROM users').get() as { id: number; default_workspace_id: number; role: string };
  assert.equal(user.role, 'admin');
  assert.deepEqual(memberships(db), [{ workspace_id: user.default_workspace_id, user_id: user.id, role: 'owner' }]);
});

test('createFirstAdmin makes an admin who owns the new workspace', async () => {
  const db = openDatabase(':memory:');
  const user = await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' });
  assert.equal(user.role, 'admin');
  assert.equal(user.disabled_at, null);
  assert.deepEqual(memberships(db), [{ workspace_id: user.default_workspace_id, user_id: user.id, role: 'owner' }]);
  assert.deepEqual(listWorkspacesForUser(db, user.id).map((ws) => ws.id), [user.default_workspace_id]);
});

test('isWorkspaceMember and listWorkspacesForUser see only the workspaces a user belongs to', async () => {
  const db = openDatabase(':memory:');
  const owner = await createFirstAdmin(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' });
  const shared = createWorkspace(db, 'Shared').id;
  const memberId = Number(db.prepare(`
    INSERT INTO users (email, password_hash, api_token, default_workspace_id, created_at, updated_at)
    VALUES ('member@example.com', 'x', ?, ?, ?, ?)
  `).run(generateApiToken(), shared, NOW, NOW).lastInsertRowid);
  addWorkspaceMember(db, shared, memberId, 'member');
  const outsiderId = Number(db.prepare(`
    INSERT INTO users (email, password_hash, api_token, default_workspace_id, created_at, updated_at)
    VALUES ('outsider@example.com', 'x', ?, ?, ?, ?)
  `).run(generateApiToken(), shared, NOW, NOW).lastInsertRowid);

  assert.equal(isWorkspaceMember(db, owner.id, owner.default_workspace_id), true);
  assert.equal(isWorkspaceMember(db, owner.id, shared), false);
  assert.equal(isWorkspaceMember(db, memberId, shared), true);
  assert.equal(isWorkspaceMember(db, memberId, owner.default_workspace_id), false);
  assert.equal(isWorkspaceMember(db, outsiderId, shared), false);

  assert.deepEqual(listWorkspacesForUser(db, owner.id).map((ws) => ws.id), [owner.default_workspace_id]);
  assert.deepEqual(listWorkspacesForUser(db, memberId).map((ws) => ws.name), ['Shared']);
  assert.deepEqual(listWorkspacesForUser(db, outsiderId), []);
  assert.equal(getUser(db, memberId)!.role, 'user');
});

test('addUser signs a second account in on the same app with its own workspace', async () => {
  const first = await setup();
  const second = await addUser(first, { email: 'second@example.com', role: 'user' });
  const admin = await addUser(first, { email: 'admin@example.com', role: 'admin' });

  assert.equal(second.db, first.db);
  assert.deepEqual([first.user.role, second.user.role, admin.user.role], ['admin', 'user', 'admin']);
  assert.equal(new Set([first.wid, second.wid, admin.wid]).size, 3, 'each account has its own workspace');
  assert.deepEqual(memberships(first.db).filter((row) => row.user_id !== first.user.id), [
    { workspace_id: second.wid, user_id: second.user.id, role: 'owner' },
    { workspace_id: admin.wid, user_id: admin.user.id, role: 'owner' },
  ]);

  for (const ctx of [first, second, admin]) {
    const byToken = await ctx.json('GET', '/api/v9/me');
    assert.equal(byToken.status, 200);
    assert.equal(byToken.body.id, ctx.user.id);
    assert.equal(byToken.body.default_workspace_id, ctx.wid);

    const cookie = await sessionCookie(ctx);
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
  const owner = await setup();
  // An instance admin who joins as a member is not a workspace admin; a plain user who owns a workspace is.
  const member = await addUser(owner, { email: 'member@example.com', role: 'admin', fullname: 'Member' });
  const outsider = await addUser(owner, { email: 'outsider@example.com', role: 'user' });
  addWorkspaceMember(owner.db, owner.wid, member.user.id, 'member');

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
  const owner = await setup();
  const member = await addUser(owner, { email: 'member@example.com', role: 'admin', fullname: 'Member', timezone: 'Europe/Madrid' });
  const outsider = await addUser(owner, { email: 'outsider@example.com', role: 'user' });
  addWorkspaceMember(owner.db, owner.wid, member.user.id, 'member');

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
    workspace: await read(base),
    projects: await read(`${base}/projects`),
    tasks: await read(`${base}/tasks`),
    clients: await read(`${base}/clients`),
    tags: await read(`${base}/tags`),
    entries: await read('/api/v9/me/time_entries?start_date=2026-01-01&end_date=2027-01-01'),
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
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  const { client, project, task, tag, entry } = await seedWorkspace(a);
  const before = await workspaceState(a);

  const ws = `/api/v9/workspaces/${a.wid}`;
  const reports = `/reports/api/v3/workspace/${a.wid}`;
  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };
  const routes: Array<[string, string, unknown?]> = [
    ['GET', ws], ['PUT', ws, { name: 'Taken' }], ['GET', `${ws}/users`],
    ['POST', `${ws}/time_entries`, { start: '2026-10-02T08:00:00Z', duration: 60, workspace_id: a.wid }],
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
  assert.deepEqual(await workspaceState(a), before, 'A\'s workspace, catalog and entries are untouched');

  assert.equal((await a.json('GET', `${ws}/projects`)).status, 200, 'the owner still reaches its own workspace');
  assert.equal((await a.json('POST', `${reports}/search/time_entries/totals`, range)).status, 200);
  assert.equal((await b.json('GET', `/api/v9/workspaces/${b.wid}/projects`)).status, 200, 'B still reaches its own workspace');
});

test('a member reaches a shared workspace through the same routes', async () => {
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  addWorkspaceMember(a.db, a.wid, b.user.id, 'member');
  const project = await b.json('POST', `/api/v9/workspaces/${a.wid}/projects`, { name: 'Shared' });
  assert.equal(project.status, 200);
  const entry = await b.json('POST', `/api/v9/workspaces/${a.wid}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 60, project_id: project.body.id, workspace_id: a.wid });
  assert.equal(entry.status, 200);
  const totals = await b.json('POST', `/reports/api/v3/workspace/${a.wid}/search/time_entries/totals`,
    { start_date: '2026-10-01', end_date: '2026-10-07' });
  assert.equal(totals.status, 200);
  assert.equal(totals.body.seconds, 60);
});

test('PUT /me accepts only a default workspace the caller belongs to, and app reports follow that rule', async () => {
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  await seedWorkspace(a);
  const range = { start_date: '2026-10-01', end_date: '2026-10-07' };

  for (const wid of [a.wid, 999]) {
    const refused = await b.json('PUT', '/api/v9/me', { default_workspace_id: wid, fullname: 'Renamed' });
    assert.equal(refused.status, 400, `default_workspace_id ${wid}`);
    assert.equal(refused.body, 'Invalid default_workspace_id');
    const stored = getUser(b.db, b.user.id)!;
    assert.equal(stored.default_workspace_id, b.wid, 'B\'s default workspace is unchanged');
    assert.equal(stored.fullname, '', 'nothing else is written either');
  }
  const own = await b.json('POST', '/api/app/report', range);
  assert.equal(own.status, 200);
  assert.equal(own.body.totals.entry_count, 0, 'B\'s report holds none of A\'s entries');

  // A member may make the shared workspace its default; once the membership ends, the app reports refuse it.
  addWorkspaceMember(a.db, a.wid, b.user.id, 'member');
  const joined = await b.json('PUT', '/api/v9/me', { default_workspace_id: a.wid });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.default_workspace_id, a.wid);
  assert.equal((await b.json('POST', '/api/app/report', range)).status, 200);
  a.db.prepare('DELETE FROM workspace_users WHERE workspace_id = ? AND user_id = ?').run(a.wid, b.user.id);
  for (const path of ['/api/app/report', '/api/app/report/weekly', '/api/app/report/entries', '/api/app/report/detailed.csv',
    '/api/app/report/summary.csv']) {
    const refused = await b.json('POST', path, range);
    assert.equal(refused.status, 403, path);
    assert.equal(refused.body, 'User does not have access to this resource.', path);
  }
});

test('trash restore needs membership of the entry\'s workspace', async () => {
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  addWorkspaceMember(a.db, a.wid, b.user.id, 'member');
  const ws = `/api/v9/workspaces/${a.wid}`;
  const created = async () => (await b.json('POST', `${ws}/time_entries`,
    { start: '2026-10-01T08:00:00Z', duration: 60, workspace_id: a.wid })).body.id as number;
  const kept = await created();
  const left = await created();
  for (const id of [kept, left]) assert.equal((await b.json('DELETE', `${ws}/time_entries/${id}`)).status, 200);

  const restored = await b.json('POST', `/api/app/time_entries/${kept}/restore`);
  assert.equal(restored.status, 200, 'a member restores its entry');
  assert.equal(restored.body.id, kept);

  a.db.prepare('DELETE FROM workspace_users WHERE workspace_id = ? AND user_id = ?').run(a.wid, b.user.id);
  const refused = await b.json('POST', `/api/app/time_entries/${left}/restore`);
  assert.equal(refused.status, 403);
  assert.equal(refused.body, 'User does not have access to this resource.');
  const row = a.db.prepare('SELECT deleted_at FROM time_entries WHERE id = ?').get(left) as { deleted_at: string | null };
  assert.notEqual(row.deleted_at, null, 'the entry stays in the trash');
});

test('a non-member cannot delete another workspace\'s project or trash its entries', async () => {
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  const { project, entry } = await seedWorkspace(a);
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
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  await seedWorkspace(a, 'A ');
  await seedWorkspace(b, 'B ');

  assert.deepEqual(await meCollections(a), expectedCollections([a.wid], ['A ']));
  assert.deepEqual(await meCollections(b), expectedCollections([b.wid], ['B ']));

  addWorkspaceMember(a.db, a.wid, b.user.id, 'member');
  assert.deepEqual(await meCollections(b), expectedCollections([a.wid, b.wid], ['A ', 'B ']), 'a member also sees the shared workspace');
  assert.deepEqual(await meCollections(a), expectedCollections([a.wid], ['A ']), 'joining does not show B\'s workspace to A');
});

test('the JSON export holds only the caller\'s workspaces and catalog, no secrets, and still restores', async () => {
  const a = await setup();
  const b = await addUser(a, { email: 'b@example.com', role: 'user' });
  await seedWorkspace(a, 'A ');
  await seedWorkspace(b, 'B ');

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
      assert.ok(!text.includes(user.api_token), 'no API token');
      assert.ok(!text.includes(user.password_hash), 'no password hash');
    }
    assert.ok(!text.includes('scrypt$'));

    const target = await setup();
    const restored = await (await target.request('POST', '/api/app/import/json', text)).json() as any;
    assert.deepEqual(restored.errors, []);
    assert.deepEqual([restored.clients, restored.projects, restored.tasks, restored.tags, restored.time_entries], [1, 1, 1, 1, 1]);
    const restoredProjects = (await target.json('GET', '/api/v9/me/projects')).body;
    assert.deepEqual(restoredProjects.map((p: any) => [p.name, p.client_name]), [[`${prefix}Project`, `${prefix}Client`]]);
    const again = await (await target.request('POST', '/api/app/import/json', text)).json() as any;
    assert.deepEqual([again.time_entries, again.skipped_duplicates], [0, 1], 'restoring twice changes nothing');
  }
});
