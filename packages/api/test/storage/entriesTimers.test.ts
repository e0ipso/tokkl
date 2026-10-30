import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';
import { createCatalogRepositories } from '../../src/storage/repositories/catalogs.ts';
import { createEntryRepositories } from '../../src/storage/repositories/entries.ts';
import { createTimerRepositories } from '../../src/storage/repositories/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: entry persistence preserves exact times, metadata, ordering and one live entry`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => ({ ...createAccountRepositories(db, backend),
      ...createCatalogRepositories(db, backend), ...createEntryRepositories(db, backend), ...createTimerRepositories(db, backend) }));
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount({ email: 'entry@example.test', fullName: 'Entries', passwordHash: 'hash', apiToken: 'token', timezone: 'UTC', role: 'admin', preferences: {} }));
      const wid = user.defaultWorkspaceId;
      const entry = await runner.transaction(async ctx => {
        const tags = await ctx.tags.resolveNames(wid, ['Zulu', 'alpha']);
        return ctx.entries.create({ userId: user.id, workspaceId: wid, projectId: null, taskId: null,
          description: 'exact', start: '2026-10-14T09:00:01.000Z', stop: null, billable: false,
          durationOnly: true, allDay: false, createdWith: 'test', deletedAt: null, tagIds: tags.map(t => t.id) });
      });
      assert.deepEqual(entry.tags.map(t => t.name), ['alpha', 'Zulu']);
      assert.equal((await runner.readSnapshot(ctx => ctx.timers.read(user.id))).running?.id, entry.id);
      await assert.rejects(runner.transaction(ctx => ctx.entries.create({ ...entry, tagIds: [], description: 'conflict' })), { kind: 'unique' });
      await runner.transaction(ctx => ctx.entries.softDelete(user.id, wid, entry.id, '2026-10-14T10:00:00.000Z'));
      assert.equal(await runner.readSnapshot(ctx => ctx.entries.running(user.id)), undefined);
      assert.equal((await runner.readSnapshot(ctx => ctx.entries.listDeleted(user.id))).length, 1);
      await runner.transaction(async ctx => {
        for (let i = 0; i < 25; i++) await ctx.entries.create({ ...entry, tagIds: entry.tags.map(t => t.id),
          start: `2026-10-14T09:${String(i).padStart(2, '0')}:00.000Z`, stop: '2026-10-14T10:00:00.000Z', description: `history ${i}` });
      });
      let selects = 0;
      const counted = createTransactionRunner({ ...connection, db: connection.db.withPlugin({
        transformQuery(args) { if (args.node.kind === 'SelectQueryNode') selects++; return args.node; },
        async transformResult(args) { return args.result; },
      }) }, db => ({ ...createAccountRepositories(db, backend), ...createCatalogRepositories(db, backend), ...createEntryRepositories(db, backend), ...createTimerRepositories(db, backend) }));
      const listed = await counted.readSnapshot(ctx => ctx.entries.list(user.id));
      assert.equal(listed.length, 25); assert.equal(selects, 2, 'one joined entry projection plus one batched tag query');
      assert.ok(listed.every(e => e.tags.length === 2));
      const bounds = await runner.readSnapshot(ctx => ctx.entries.bounds(user.id));
      assert.equal(bounds.firstStart, '2026-10-14T09:00:00.000Z'); assert.equal(bounds.lastStart, '2026-10-14T09:24:00.000Z');
      assert.equal((await runner.readSnapshot(ctx => ctx.entries.list(user.id, { projectIds: [] }))).length, 0);
      assert.equal((await runner.readSnapshot(ctx => ctx.entries.list(user.id, { projectIds: [null], limit: 5 }))).length, 5);
      assert.equal((await runner.readSnapshot(ctx => ctx.entries.list(user.id, { changedSince: '2020-01-01T00:00:00.000Z' }))).length, 26);
      assert.equal(await runner.readSnapshot(ctx => ctx.entries.findDuplicate({ userId: user.id, start: '2026-10-14T09:01:00.000Z', stop: '2026-10-14T10:00:00.000Z', description: 'history 1', projectId: null })), listed.find(e => e.description === 'history 1')?.id);

    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
