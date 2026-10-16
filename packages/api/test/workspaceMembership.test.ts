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
import { createOwner, getUser } from '../src/models/users.ts';
import {
  addWorkspaceMember, createWorkspace, isWorkspaceMember, listWorkspacesForUser,
} from '../src/models/workspaces.ts';
import { addUser, PASSWORD, sessionCookie, setup, testConfig, testServer } from './helpers.ts';

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

test('a fresh database has no memberships until setup creates the owner', async () => {
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
  const user = db.prepare('SELECT id, default_workspace_id FROM users').get() as { id: number; default_workspace_id: number };
  assert.deepEqual(memberships(db), [{ workspace_id: user.default_workspace_id, user_id: user.id, role: 'owner' }]);
});

test('createOwner makes an admin who owns the new workspace', async () => {
  const db = openDatabase(':memory:');
  const user = await createOwner(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' });
  assert.equal(user.role, 'admin');
  assert.equal(user.disabled_at, null);
  assert.deepEqual(memberships(db), [{ workspace_id: user.default_workspace_id, user_id: user.id, role: 'owner' }]);
  assert.deepEqual(listWorkspacesForUser(db, user.id).map((ws) => ws.id), [user.default_workspace_id]);
});

test('isWorkspaceMember and listWorkspacesForUser see only the workspaces a user belongs to', async () => {
  const db = openDatabase(':memory:');
  const owner = await createOwner(db, { email: 'me@example.com', password: PASSWORD, fullname: 'Me', timezone: 'UTC' });
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
