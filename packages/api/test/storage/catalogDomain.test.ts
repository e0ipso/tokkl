import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createCatalogRepositories } from '../../src/storage/repositories/catalogs.ts';
import * as catalog from '../../src/domain/catalogs.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: catalog domain validation, DTOs, archive/restore and timer hooks`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => createCatalogRepositories(db, backend));
    try {
      await connection.db.insertInto('workspaces').values({ id: 1, name: 'Catalog', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }).execute();
      const client = await runner.transaction(ctx => catalog.createClient(ctx, 1, { name: '  ACME  ', notes: 'net 30', archived: true }));
      assert.equal(client.name, 'ACME'); assert.equal(client.archived, false);
      assert.equal(catalog.serializeClient(client).wid, 1);
      const p = await runner.transaction(ctx => catalog.createProject(ctx, 1, { name: ' Website ', client_name: 'acme', color: '#ABCDEF', rate: 80, currency: 'eur', estimated_hours: 10 }));
      assert.equal(p.clientId, client.id); assert.equal(p.color, '#abcdef');
      assert.equal(catalog.serializeProject(p, 'USD').estimated_seconds, 36000);
      const t = await runner.transaction(ctx => catalog.createTask(ctx, 1, p.id, { name: ' Design ', estimated_seconds: 300 }));
      assert.equal(catalog.serializeTask(t).tracked_seconds, 0);
      await assert.rejects(runner.transaction(ctx => catalog.createClient(ctx, 1, { name: 'acme' })), { status: 400, message: 'Name has already been taken' });
      await assert.rejects(runner.transaction(ctx => catalog.createProject(ctx, 1, { name: 'Bad', rate: 1e10 })), { status: 400, message: 'Invalid rate: expected at most 1000000000' });
      const events: string[] = [];
      const effects: catalog.CatalogTimerEffects = {
        async prepare(ctx, wid) {
          assert.equal(wid, 1); events.push('prepare');
          assert.ok(await ctx.projects.getRef(1, p.id));
          return { async settle() { events.push('settle'); assert.equal((await ctx.projects.getRef(1, p.id))?.active, false); },
            async publish() { events.push('publish'); assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p.id)))?.active, false); } };
        },
        async removeTagFromPauseChains() { throw new Error('unexpected tag deletion'); },
      };
      const archived = await runner.transaction(ctx => catalog.setClientArchived(ctx, 1, client.id, true, effects));
      assert.deepEqual(archived, [p.id]); assert.deepEqual(events, ['prepare', 'settle', 'publish']);
      await assert.rejects(runner.transaction(ctx => catalog.createTask(ctx, 1, p.id, { name: 'No' })), { status: 400, message: 'Can not change tasks of archived project' });
      let publications = 0;
      const edits: catalog.CatalogTimerEffects = {
        async prepare(ctx) { return { async settle() { assert.ok(await ctx.clients.get(1, client.id)); }, async publish() { publications++; } }; },
        async removeTagFromPauseChains(ctx, tagId) { assert.ok(await ctx.tags.get(1, tagId)); events.push('remove-tag'); },
      };
      const p2 = await runner.transaction(ctx => catalog.createProject(ctx, 1, { name: 'Second', client_id: client.id, active: false }));
      const put = await runner.transaction(ctx => catalog.updateClient(ctx, 1, client.id, { archived: false, notes: null }, edits));
      assert.equal(put.notes, null); assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p.id)))?.active, false);
      await runner.transaction(ctx => catalog.restoreClient(ctx, 1, client.id, {}, edits));
      assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p.id)))?.active, false);
      await runner.transaction(ctx => catalog.restoreClient(ctx, 1, client.id, { projects: [p.id] }, edits));
      assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p.id)))?.active, true);
      assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p2.id)))?.active, false);
      const unrelated = await runner.transaction(ctx => catalog.createProject(ctx, 1, { name: 'Unrelated' }));
      await assert.rejects(runner.transaction(ctx => catalog.restoreClient(ctx, 1, client.id, { projects: [unrelated.id] }, edits)), { status: 400, message: 'Project does not belong to the client' });
      await runner.transaction(ctx => catalog.restoreClient(ctx, 1, client.id, { restore_all_projects: true }, edits));
      assert.equal((await runner.readSnapshot(r => r.projects.getRef(1, p2.id)))?.active, true);
      const cleared = await runner.transaction(ctx => catalog.updateProject(ctx, 1, p.id, { client_id: null, cid: client.id, billable: true, is_private: false, rate: 0, currency: '', start_date: '2099-01-01' }, edits));
      assert.equal(cleared.clientId, null); assert.equal(cleared.currency, null); assert.equal(cleared.rate, 0);
      assert.equal(catalog.serializeProject(cleared, 'USD').status, 'upcoming');
      const changed = await runner.transaction(ctx => catalog.updateTask(ctx, 1, p.id, t.id, { name: ' Changed ', active: false, estimated_seconds: null }, edits));
      assert.equal(changed.name, 'Changed'); assert.equal(changed.estimatedSeconds, null); assert.equal(changed.active, false);
      assert.equal(changed.projectIsPrivate, false); assert.equal(changed.projectBillable, true);
      for (const [body, message] of [
        [{ name: null }, "Project name can't be blank"], [{ name: 'x'.repeat(256) }, 'Project name must be at most 255 characters'],
        [{ name: 'X', color: 'red' }, 'Invalid color: expected #rrggbb'], [{ name: 'X', active: 'yes' }, 'Invalid active: expected a boolean'],
        [{ name: 'X', currency: 'EURO' }, 'Invalid currency: expected an ISO 4217 code'], [{ name: 'X', start_date: 'bad' }, 'Invalid start_date: expected YYYY-MM-DD'],
        [{ name: 'X', estimated_hours: -1 }, 'Invalid estimated_hours: expected a non-negative number'],
        [{ name: 'X', rate: Infinity }, 'Invalid rate: expected a non-negative number'], [{ name: 'X', fixed_fee: true }, 'Invalid fixed_fee: expected a non-negative number'],
      ] as const) await assert.rejects(runner.transaction(ctx => catalog.createProject(ctx, 1, body)), { status: 400, message });
      await assert.rejects(runner.transaction(ctx => catalog.createClient(ctx, 1, { name: 'X', notes: 4 })), { status: 400, message: 'Invalid notes: expected a string' });
      await assert.rejects(runner.transaction(ctx => catalog.createTag(ctx, 1, { name: null })), { status: 400, message: "Tag name can't be blank" });
      const names = await runner.transaction(ctx => catalog.resolveTagNames(ctx, 1, [' urgent ', 'URGENT', 'É', 'é']));
      assert.equal(names[0], names[1]); assert.notEqual(names[2], names[3]);
      const tag = await runner.transaction(ctx => catalog.createTag(ctx, 1, { name: 'Later' }));
      await assert.rejects(runner.transaction(ctx => catalog.updateTag(ctx, 1, tag.id, { name: 'URGENT' }, edits)), { status: 400, message: 'A tag with the same name already exists' });
      const renamed = await runner.transaction(ctx => catalog.updateTag(ctx, 1, tag.id, { name: ' Renamed ' }, edits));
      assert.equal(catalog.serializeTag(renamed).name, 'Renamed');
      const before = publications;
      await assert.rejects(runner.transaction(async ctx => { await catalog.updateTag(ctx, 1, tag.id, { name: 'Rollback' }, edits); throw new Error('rollback'); }), /rollback/);
      assert.equal(publications, before); assert.equal((await runner.readSnapshot(r => r.tags.get(1, tag.id)))?.name, 'Renamed');
      await runner.transaction(async ctx => {
        await ctx.savepoint(async sp => { await catalog.updateTag(sp, 1, tag.id, { name: 'Discard' }, edits); throw new Error('discard'); }).catch(() => {});
      });
      assert.equal(publications, before);
      await runner.transaction(ctx => catalog.deleteTag(ctx, 1, tag.id, edits));
      assert.ok(events.includes('remove-tag')); assert.equal(await runner.readSnapshot(r => r.tags.get(1, tag.id)), undefined);
      await runner.transaction(ctx => catalog.deleteTask(ctx, 1, p.id, t.id, edits));
      assert.equal(await runner.readSnapshot(r => r.tasks.getRef(1, t.id)), undefined);
      const outcomes = await Promise.allSettled([0, 1].map(() => runner.transaction(ctx => catalog.createTag(ctx, 1, { name: 'Concurrent' }))));
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
      const loser = outcomes.find(o => o.status === 'rejected'); assert.equal(loser?.status === 'rejected' && loser.reason.status, 400);

    } finally { await connection.close(); await fixture.cleanup(); }
  });
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: fractional task estimate compatibility`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => createCatalogRepositories(db, backend));
    try {
      await connection.db.insertInto('workspaces').values({ id: 1, name: 'Catalog', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }).execute();
      const p = await runner.transaction(ctx => catalog.createProject(ctx, 1, { name: 'Fraction' }));
      const t = await runner.transaction(ctx => catalog.createTask(ctx, 1, p.id, { name: 'Fraction', estimated_seconds: 1.5 }));
      assert.equal(catalog.serializeTask(t).estimated_seconds, 1.5);
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}

test('legacy HTTP accepts fractional task estimates', async () => {
  const { setup } = await import('../helpers.ts');
  const ctx = await setup();
  const base = `/api/v9/workspaces/${ctx.wid}`;
  const p = await ctx.json('POST', `${base}/projects`, { name: 'Fraction' });
  const t = await ctx.json('POST', `${base}/projects/${p.body.id}/tasks`, { name: 'Fraction', estimated_seconds: 1.5 });
  assert.equal(t.status, 200); assert.equal(t.body.estimated_seconds, 1.5);
});
