import { addWorkspaceMember } from './fixtures/domain.ts';
import { sessionCount, tokenRows, settingRows } from './fixtures/physical.ts';
import { storageFor } from './fixtures/database.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FixtureDatabase } from './fixtures/database.ts';
import { addUser, CSRF, sessionCookie, setup, type TestContext } from './helpers.ts';

/** Gives the account a client, a project with a task, a tag and a tagged entry in its own workspace. */
async function seed(ctx: TestContext): Promise<void> {
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const created = async (path: string, body: Record<string, unknown>) => {
    const response = await ctx.json('POST', `${ws}${path}`, body);
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.body)}`);
    return response.body.id as number;
  };
  const client = (await created('/clients', { name: `${ctx.user.email} client` }));
  const project = (await created('/projects', { name: 'Project', client_id: client }));
  const task = (await created(`/projects/${project}/tasks`, { name: 'Task' }));
  (await created('/tags', { name: 'tag' }));
  (await created('/time_entries', {
    start: '2026-10-01T08:00:00Z', duration: 600, project_id: project, task_id: task, tags: ['tag'], created_with: 'test',
  }));
}

const TABLES = ['workspaces', 'clients', 'projects', 'tasks', 'tags', 'time_entries'] as const;

/** Rows per table that belong to `userId`'s workspaces or to the account itself. */
async function owned(db: FixtureDatabase, userId: number, wid: number): Promise<Record<string, number>> {
 const storage=storageFor(db);
 const entries=(await storage.entries.list(userId)).filter(row=>row.workspaceId===wid);
 return {workspaces:Number(!!await storage.workspaces.get(wid)),clients:(await storage.clients.list(wid,{status:'both'})).length,
 projects:await storage.projects.count(wid),tasks:(await storage.tasks.list(wid)).length,tags:(await storage.tags.list(wid)).length,
 time_entries:entries.length,time_entry_tags:entries.reduce((sum,row)=>sum+row.tags.length,0),users:Number(!!await storage.users.get(userId)),
 sessions:await sessionCount(db,userId),memberships:(await storage.workspaces.listForUser(userId)).length};
}

const remove = (admin: TestContext, target: TestContext, body: unknown = { email: target.user.email }) =>
  admin.json('DELETE', `/api/app/admin/users/${target.user.id}`, body);

test('deleting a user removes their workspace, its data, their sessions and memberships, and nobody else\'s', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'user' }));
  for (const ctx of [admin, bob, carol]) (await seed(ctx));
  (await sessionCookie(bob));
  (await sessionCookie(carol));
  const bobBefore = (await owned(admin.db, bob.user.id, bob.wid));
  assert.ok(Object.values(bobBefore).every((n) => n >= 1), JSON.stringify(bobBefore));
  const others = () => Promise.all([owned(admin.db, admin.user.id, admin.wid), owned(admin.db, carol.user.id, carol.wid)]);
  const othersBefore = (await others());

  const response = await remove(admin, bob);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.deepEqual((await owned(admin.db, bob.user.id, bob.wid)), Object.fromEntries(Object.keys(bobBefore).map((key) => [key, 0])));
  assert.deepEqual((await others()), othersBefore, 'other accounts keep their workspaces, entries and sessions');
  assert.equal((await carol.json('GET', '/api/v9/me/time_entries?start_date=2026-09-30&end_date=2026-10-02')).body.length, 1);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/users')).body.map((user: { email: string }) => user.email),
    ['me@example.com', 'carol@example.com']);
  assert.equal((await remove(admin, bob)).status, 404, 'an unknown id');
});

test('a workspace shared with another member stays; only the deleted account\'s rows leave it', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  await addWorkspaceMember(admin.db,admin.wid,bob.user.id,'member');
  assert.equal((await remove(admin, bob)).status, 200);
  assert.ok(await storageFor(admin.db).workspaces.get(admin.wid), 'the shared workspace stays');
  assert.equal(await storageFor(admin.db).workspaces.get(bob.wid), undefined);
});

test('a missing or wrong email returns 400 and deletes nothing', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  (await seed(bob));
  const before = (await owned(admin.db, bob.user.id, bob.wid));
  for (const body of [{}, { email: 'carol@example.com' }, { email: 5 }, { email: null }, '', 'bob@example.com']) {
    assert.equal((await remove(admin, bob, body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await owned(admin.db, bob.user.id, bob.wid)), before);
  // The confirmation compares accounts the way sign-in does: trimmed, ASCII case folded.
  assert.equal((await remove(admin, bob, { email: ' BOB@example.com ' })).status, 200);
});

test('nobody deletes themselves or the last active admin', async () => {
  const admin = (await setup());
  const alone = await remove(admin, admin);
  assert.equal(alone.status, 400);
  assert.equal(alone.body, 'At least one active admin must remain');

  const second = (await addUser(admin, { email: 'second@example.com', role: 'admin' }));
  const self = await remove(second, second);
  assert.equal(self.status, 400);
  assert.equal(self.body, 'You cannot delete your own account');
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body.length, 2);

  // An admin may delete another admin while one active admin remains.
  assert.equal((await remove(admin, second)).status, 200);
});

test('a regular user gets 403', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const carol = (await addUser(admin, { email: 'carol@example.com', role: 'user' }));
  assert.equal((await remove(bob, carol)).status, 403);
  assert.equal((await remove(bob, admin)).status, 403);
  assert.equal((await admin.json('GET', '/api/app/admin/users')).body.length, 3);
});

test('the deleted account\'s session cookie and API token stop working', async () => {
  const admin = (await setup());
  const bob = (await addUser(admin, { email: 'bob@example.com', role: 'user' }));
  const cookie = (await sessionCookie(bob));
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: '', cookie })).status, 200);
  assert.equal((await bob.request('GET', '/api/v9/me')).status, 200);

  assert.equal((await remove(admin, bob)).status, 200);
  assert.equal((await bob.request('GET', '/api/v9/me', undefined, { authorization: '', cookie })).status, 403);
  assert.equal((await bob.request('GET', '/api/v9/me')).status, 403);
});

test('a deleted admin\'s pending invites stop working; their used invites and settings changes stay', async () => {
  const admin = (await setup());
  const second = (await addUser(admin, { email: 'second@example.com', role: 'admin' }));
  const createInvite = async () => {
    const response = await second.json('POST', '/api/app/admin/invites', { role: 'user' });
    assert.equal(response.status, 200);
    return (response.body.url as string).replace(/^\/invite\//, '');
  };
  const pending = (await createInvite());
  const used = (await createInvite());
  const accepted = await second.request('POST', `/api/app/invites/${used}`, { email: 'dana@example.com', password: 'dana password' }, { authorization: '', ...CSRF });
  assert.equal(accepted.status, 200);
  assert.equal((await second.json('PUT', '/api/app/admin/settings', { invite_days: 4 })).status, 200);

  assert.equal((await remove(admin, second)).status, 200);
  assert.equal((await admin.request('GET', `/api/app/invites/${pending}`, undefined, { authorization: '' })).status, 404);
  assert.deepEqual((await admin.json('GET', '/api/app/admin/invites')).body, []);
  const usedRow = (await tokenRows(admin.db)).find(row=>row.used_at!==null)!;
  assert.equal(usedRow.created_by, null, 'the record of the used invite stays without its creator');
  assert.ok(await storageFor(admin.db).users.findByEmail('dana@example.com'), 'the invited account stays');
  assert.deepEqual((await admin.json('GET', '/api/app/admin/settings')).body, { session_days: 30, invite_days: 4, time_resolution_minutes: 5 });
  assert.equal((await settingRows(admin.db)).find(row=>row.key==='invite_days')!.updated_by, null);
});
