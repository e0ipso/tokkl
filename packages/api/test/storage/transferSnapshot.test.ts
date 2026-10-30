import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { createTimeEntry } from '../../src/domain/timeEntries.ts';
import { createTimerPublication } from '../../src/domain/timers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryTimerFactory, entryAccount } from './support/entry-timer.ts';
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: bounded scoped export projections retain one snapshot across concurrent writes`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend), connection = await initializeDatabase(fixture.config), writer = await openConnection<PhysicalDatabase>(fixture.config);
    const factory = entryTimerFactory(backend), runner = createTransactionRunner(connection, factory), writes = createTransactionRunner(writer, factory);
    const publish = createTimerPublication(async () => {});
    try {
      const user = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('export-scope')));
      const stranger = await runner.transaction(ctx => ctx.users.createAccount(entryAccount('excluded')));
      const client = await runner.transaction(ctx => ctx.clients.create({ workspaceId: user.defaultWorkspaceId, name: 'before', archived: true, notes: null }));
      await runner.transaction(async ctx => {
        await ctx.clients.create({ workspaceId: stranger.defaultWorkspaceId, name: 'excluded', archived: false, notes: null });
        for (let i = 0; i < 4; i++) {
          const w = await ctx.workspaces.create(`shared ${i}`);
          await ctx.workspaces.addMember({ workspaceId: w.id, userId: user.id, role: 'member' });
          await ctx.clients.create({ workspaceId: w.id, name: `shared ${i}`, archived: false, notes: null });
        }
      });
      for (let i = 0; i < 25; i++) await runner.transaction(ctx => createTimeEntry(ctx, user, user.defaultWorkspaceId,
        { start: '2026-10-01T08:00:07Z', stop: '2026-10-01T08:10:09Z', description: String(i), tags: ['a', 'z'] }, publish, { exact: true }));
      await runner.transaction(ctx => createTimeEntry(ctx, stranger, stranger.defaultWorkspaceId,
        { start: '2026-10-02T08:00:00Z', stop: '2026-10-02T09:00:00Z', description: 'excluded' }, publish));
      let selects = 0, changed = false;
      const selectIds = new Set<object>();
      const db = connection.db.withPlugin({
        transformQuery(args) {
          if (args.node.kind === 'SelectQueryNode') {
            selectIds.add(args.queryId);
            const ast = JSON.stringify(args.node);
            assert.ok(!ast.includes('password_hash')); assert.ok(!ast.includes('api_token'));
          }
          return args.node;
        },
        async transformResult(args) {
          if (selectIds.has(args.queryId)) selects++;
          if (selects === 1 && !changed) {
            changed = true;
            await writes.transaction(ctx => ctx.clients.update(user.defaultWorkspaceId, client.id, { name: 'after' }));
          }
          return args.result;
        },
      });
      const reader = createTransactionRunner({ ...connection, db }, handle => createTransferRepositories(handle, backend));
      const snapshot = await reader.readSnapshot(ctx => ctx.transfers.exportAccount(user.id));
      assert.equal(changed, true); assert.equal(selects, 9);
      assert.equal(snapshot.workspaces.length, 5); assert.equal(snapshot.entries.length, 25);
      assert.ok(snapshot.clients.some(c => c.name === 'before')); assert.ok(!snapshot.clients.some(c => c.name === 'after' || c.name === 'excluded'));
      assert.ok(snapshot.entries.every(e => e.tags.map(t => t.name).join(',') === 'a,z'));
      const next = await createTransactionRunner(connection, handle => createTransferRepositories(handle, backend)).readSnapshot(ctx => ctx.transfers.exportAccount(user.id));
      assert.ok(next.clients.some(c => c.name === 'after'));
      assert.ok(!('passwordHash' in next.user)); assert.ok(!('apiToken' in next.user));
      console.log(`${backend}: export selected ${selects} relational queries for 5 workspaces and 25 entries`);
    } finally { await writer.close(); await connection.close(); await fixture.cleanup(); }
  });
}
