import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorage } from '../fixtures/storageShortcuts.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createAccountOperations } from '../fixtures/accountBodies.ts';

import { composeApp } from '../fixtures/app.ts';
import { testConfig, testServer, setup, addUser } from '../helpers.ts';
import { addWorkspaceMember } from '../fixtures/domain.ts';
import { gate } from './support/invariantHttp.ts';
test('credentials revoked after HTTP authentication cannot authorize an entry write', async t => {
  const storage = createStorage(
    await initializeDatabase({ backend: 'sqlite', filename: ':memory:', busyTimeoutMs: 5000 }),
  );
  const accounts = createAccountOperations(storage, { recheckUser: async () => {} });
  const user = await accounts.createFirstAdmin({
    email: 'me@example.test',
    password: 'correct horse battery',
    fullname: 'Me',
    timezone: 'UTC',
  });
  const entered = gate(),
    release = gate();
  let intercept = true;
  const { app, close } = composeApp({
    storage: {
      ...storage,
      transaction: async (work, options) => {
        if (intercept) {
          intercept = false;
          entered.resolve();
          await release.promise;
        }
        return storage.transaction(work, options);
      },
    },
    config: testConfig(),
    setup: { code: null },
  });
  t.after(async () => {
    release.resolve();
    await close();
    await storage.close();
  });
  const server = testServer(app);
  const request = server.request(`/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}` },
    body: JSON.stringify({ start: '2026-10-30T12:00:00Z', description: 'stale' }),
  });
  await entered.promise;
  await accounts.rotateApiToken(user, { kind: 'api-token', token: user.apiToken });
  release.resolve();
  const result = await request;
  assert.equal(result.status, 403);
  assert.equal(await result.json(), 'Incorrect username and/or password');
  assert.equal((await storage.entries.list(user.id)).length, 0);
});
test('a catalog actor and every affected timer owner lock together in sorted order', async () => {
  const owner = await setup();
  const actor = await addUser(owner, { email: 'actor@example.test', role: 'user' });
  await addWorkspaceMember(owner.db, owner.wid, actor.user.id, 'member');
  const base = `/api/v9/workspaces/${owner.wid}`;
  const project = (await owner.json('POST', base + '/projects', { name: 'Before' })).body;
  assert.equal(
    (await owner.json('POST', base + '/time_entries', { start: '2026-10-30T12:00:00Z', project_id: project.id }))
      .status,
    200,
  );
  const result = await actor.json('PUT', base + `/projects/${project.id}`, { name: 'After' });
  assert.equal(result.status, 200);
  assert.equal((await owner.json('GET', '/api/app/timer')).body.running_entry.project_name, 'After');
});
// SQLite is not in this loop: BEGIN IMMEDIATE makes a second writer wait for the first by design.
for (const backend of ['postgres', 'mysql', 'mariadb'] as const)
  test(
    `${backend}: independent timer owners can write while another owner holds its guards`,
    { timeout: 180000 },
    async t => {
      const { disposableBackend } = await import('./support/disposableBackend.ts');
      const fixture = await disposableBackend(backend);
      t.after(() => fixture.cleanup());
      const storage = createStorage(await initializeDatabase(fixture.config));
      t.after(() => storage.close());
      const users = await storage.transaction(async ctx => {
        const out = [];
        for (const name of ['owner', 'other'])
          out.push(
            await ctx.users.createAccount({
              email: `${name}@example.test`,
              fullName: name,
              passwordHash: 'hash',
              apiToken: name,
              timezone: 'UTC',
              role: 'admin',
              preferences: {},
            }),
          );
        return out;
      });
      const { app, services, close } = composeApp({
        storage,
        config: { ...testConfig(), storage: fixture.config },
        setup: { code: null },
      });
      t.after(() => close());
      const { createTimeEntry } = await import('../fixtures/entryBodies.ts');
      const entered = gate(),
        release = gate();
      const owner = users[0]!,
        other = users[1]!,
        server = testServer(app);
      let ownerEntry = 0,
        otherEntry = 0;
      const start = (user: typeof owner, at: string) =>
        server.request(`/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`, {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}` },
          body: JSON.stringify({ start: at }),
        });
      // Each owner already runs a timer, so the starts below also stop one. That switch must not lock the other owner's rows on InnoDB.
      const seeded: number[] = [];
      for (const user of [owner, other]) {
        const result = await start(user, '2026-10-30T10:00:00Z');
        assert.equal(result.status, 200);
        seeded.push(((await result.json()) as { id: number }).id);
      }
      // An entry write that holds the owner's guards until released.
      const held = storage.transaction(async ctx => {
        ownerEntry = (
          await createTimeEntry(
            ctx,
            owner,
            owner.defaultWorkspaceId,
            { start: '2026-10-30T12:00:00Z' },
            services.push.publish,
          )
        ).id;
        entered.resolve();
        await release.promise;
      });
      try {
        await entered.promise;
        const response = start(other, '2026-10-30T12:00:00Z');
        let timer: NodeJS.Timeout | undefined;
        try {
          const result = await Promise.race([
            response,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Error('unrelated owner blocked on global guard')), 2000);
            }),
          ]);
          assert.equal(result.status, 200);
          otherEntry = ((await result.json()) as { id: number }).id;
        } finally {
          clearTimeout(timer);
        }
      } finally {
        release.resolve();
        await held;
      }
      const owned = await storage.entries.list(owner.id),
        others = await storage.entries.list(other.id);
      assert.deepEqual(
        owned.map(e => [e.id, e.userId, e.stop === null]),
        [
          [ownerEntry, owner.id, true],
          [seeded[0], owner.id, false],
        ],
      );
      assert.deepEqual(
        others.map(e => [e.id, e.userId, e.stop === null]),
        [
          [otherEntry, other.id, true],
          [seeded[1], other.id, false],
        ],
      );
      assert.ok(
        !owned.some(e => e.id === otherEntry || e.id === seeded[1]) &&
          !others.some(e => e.id === ownerEntry || e.id === seeded[0]),
      );
    },
  );
