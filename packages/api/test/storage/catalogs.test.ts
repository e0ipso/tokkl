import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import type { Backend } from '../../src/storage/config.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { catalogProjectQuery, catalogTaskQuery, catalogProjectRefQuery, catalogTaskRefQuery, createCatalogRepositories } from '../../src/storage/repositories/catalogs.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: catalog comparison keys, literal search and scoped uniqueness`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    const runner = createTransactionRunner(connection, db => createCatalogRepositories(db, backend));
    try {
      await connection.db.insertInto('workspaces').values({ id: 1, name: 'Catalog', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }).execute();
      for (const name of ['Alpha', 'É', 'é', 'E', 'Name', 'Name ', '%_\\']) {
        await runner.transaction(ctx => ctx.clients.create({ workspaceId: 1, name, notes: null, archived: false }));
      }
      assert.equal((await runner.readSnapshot(r => r.clients.findByName(1, 'ALPHA')))?.name, 'Alpha');
      for (const literal of ['%', '_', '\\']) {
        assert.deepEqual((await runner.readSnapshot(r => r.clients.list(1, { name: literal }))).map(c => c.name), ['%_\\']);
      }
      assert.deepEqual((await runner.readSnapshot(r => r.clients.list(1))).map(c => c.name), ['%_\\', 'Alpha', 'E', 'Name', 'Name ', 'É', 'é']);
      await assert.rejects(runner.transaction(ctx => ctx.clients.create({ workspaceId: 1, name: 'alpha', notes: null, archived: false })), { kind: 'unique' });
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: projections, lightweight references, totals indexes, detach and cleanup`, { timeout: 180000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    let queryCount = 0;
    const runner = createTransactionRunner(connection, db => createCatalogRepositories(db.withPlugin({
      transformQuery({ node }) { queryCount++; return node; }, async transformResult({ result }) { return result; },
    }), backend));
    const at = '2026-01-01T00:00:00.000Z';
    try {
      await connection.db.insertInto('workspaces').values([{ id: 1, name: 'One', created_at: at, updated_at: at }, { id: 2, name: 'Two', created_at: at, updated_at: at }]).execute();
      await connection.db.insertInto('users').values({ id: 1, email: 'catalog@example.test', password_hash: 'unused', api_token: 'unused-catalog', created_at: at, updated_at: at, disabled_at: null }).execute();
      const client = await runner.transaction(r => r.clients.create({ workspaceId: 1, name: 'ACME', notes: null, archived: false }));
      const makeProject = (name: string, clientId: number | null = null, workspaceId = 1) => runner.transaction(r => r.projects.create({ workspaceId, clientId, name, color: '#abcdef', active: true, isPrivate: false, billable: true,
        estimatedHours: 1.5, rate: 42.5, currency: 'EUR', fixedFee: null, startDate: null, endDate: null, template: false }));
      const p = await makeProject('Site', client.id);
      const task = await runner.transaction(r => r.tasks.create({ workspaceId: 1, projectId: p.id, name: 'Design', active: true, estimatedSeconds: 300 }));
      await makeProject('SITE');
      const reserved = await makeProject('Site (ACME)', client.id);
      const collision2 = await makeProject('Site (ACME) 2');
      for (const name of ['É', 'é', 'Name', 'Name ', '%_\\']) {
        const named = await makeProject(name);
        await runner.transaction(r => r.tasks.create({ workspaceId: 1, projectId: p.id, name, active: true, estimatedSeconds: null }));
        await runner.transaction(r => r.tags.create(1, name));
        assert.equal((await runner.readSnapshot(r => r.projects.findByName(1, null, name)))?.id, named.id);
      }
      await assert.rejects(makeProject('site'), { kind: 'unique' });
      await assert.rejects(runner.transaction(r => r.tasks.create({ workspaceId: 1, projectId: p.id, name: 'DESIGN', active: true, estimatedSeconds: null })), { kind: 'unique' });
      await assert.rejects(runner.transaction(r => r.tags.create(1, 'NAME')), { kind: 'unique' });
      await makeProject('site', null, 2);
      assert.equal(await runner.readSnapshot(r => r.projects.getRef(2, p.id)), undefined);
      assert.equal(await runner.readSnapshot(r => r.tasks.getRef(2, task.id)), undefined);
      assert.equal(await runner.readSnapshot(r => r.tasks.get(1, task.id, collision2.id)), undefined);
      for (const literal of ['%', '_', '\\']) {
        assert.deepEqual((await runner.readSnapshot(r => r.projects.list(1, { name: literal }))).map(r => r.name), ['%_\\']);
        assert.deepEqual((await runner.readSnapshot(r => r.tags.list(1, literal))).map(r => r.name), ['%_\\']);
        assert.deepEqual((await runner.readSnapshot(r => r.tasks.list(1, { name: literal }))).map(r => r.name), ['%_\\']);
      }
      assert.deepEqual((await runner.readSnapshot(r => r.tags.list(1))).map(r => r.name), ['%_\\', 'Name', 'Name ', 'É', 'é']);
      assert.equal((await runner.readSnapshot(r => r.tasks.findByName(1, p.id, 'NAME ')))?.name, 'Name ');
      const row = { workspace_id: 1, user_id: 1, project_id: p.id, task_id: task.id, start: '2026-01-01T00:00:00.900Z', stop: '2026-01-01T00:05:00.100Z', created_at: at, updated_at: at, deleted_at: null };
      await connection.db.insertInto('time_entries').values([{ ...row, id: 1 }, { ...row, id: 2, deleted_at: at }]).execute();
      // Unrelated history makes real optimizers choose the bounded totals indexes.
      await connection.db.insertInto('projects').values(Array.from({ length: 100 }, (_, i) => ({ id: 10000 + i, workspace_id: 1, client_id: null, name: `History ${i}`, color: '#abcdef', estimated_hours: null, rate: null, currency: null, fixed_fee: null, start_date: null, end_date: null, created_at: at, updated_at: at }))).execute();
      for (let batch = 0; batch < 4; batch++) {
        await connection.db.insertInto('time_entries').values(Array.from({ length: 250 }, (_, i) => ({ ...row, id: 10 + batch * 250 + i, project_id: 10000 + (i % 100), task_id: null }))).execute();
      }
      const total = await runner.readSnapshot(r => r.projects.get(1, p.id));
      assert.equal(total?.actualSeconds, 300);
      assert.equal((await runner.readSnapshot(r => r.tasks.get(1, task.id)))?.trackedMilliseconds, 300000);
      const earlyProject = await makeProject('Imported history before Unix epoch');
      const earlyTask = await runner.transaction(r => r.tasks.create({ workspaceId: 1, projectId: earlyProject.id, name: 'Imported', active: true, estimatedSeconds: null }));
      await connection.db.insertInto('time_entries').values({ ...row, id: 3000, project_id: earlyProject.id, task_id: earlyTask.id,
        start: '1969-12-31T23:59:59.900Z', stop: '1970-01-01T00:00:01.100Z' }).execute();
      assert.equal((await runner.readSnapshot(r => r.projects.get(1, earlyProject.id)))?.actualSeconds, 2);
      assert.equal((await runner.readSnapshot(r => r.tasks.get(1, earlyTask.id)))?.trackedMilliseconds, 2000);
      assert.deepEqual(await runner.readSnapshot(r => r.projects.getRef(1, p.id)), { id: p.id, workspaceId: 1, active: true, billable: true });
      await explainCatalog(connection.db, backend, p.id, task.id);
      let count = queryCount;
      await runner.readSnapshot(r => r.projects.list(1)); assert.equal(queryCount - count, 1);
      count = queryCount;
      await runner.readSnapshot(r => r.tasks.list(1)); assert.equal(queryCount - count, 1);
      const runningStart = new Date(Math.floor(Date.now() / 1000) * 1000 - 10000).toISOString();
      await connection.db.insertInto('time_entries').values({ ...row, id: 3, start: runningStart, stop: null }).execute();
      const lower = Math.floor(Date.now() / 1000) - Date.parse(runningStart) / 1000;
      const runningProject = await runner.readSnapshot(r => r.projects.get(1, p.id));
      const runningTask = await runner.readSnapshot(r => r.tasks.get(1, task.id));
      const upper = Math.floor(Date.now() / 1000) - Date.parse(runningStart) / 1000;
      assert.ok(runningProject!.actualSeconds >= 300 + lower && runningProject!.actualSeconds <= 300 + upper);
      assert.ok(runningTask!.trackedMilliseconds >= (300 + lower) * 1000 && runningTask!.trackedMilliseconds <= (300 + upper) * 1000);

      await runner.transaction(r => r.clients.deleteAndDetachProjects(1, client.id));
      assert.equal((await runner.readSnapshot(r => r.projects.get(1, p.id)))?.name, 'Site (ACME) 3');
      assert.equal((await runner.readSnapshot(r => r.projects.get(1, reserved.id)))?.name, 'Site (ACME)');
      assert.equal((await runner.readSnapshot(r => r.projects.get(1, p.id)))?.rate, 42.5);
      assert.equal((await runner.readSnapshot(r => r.projects.get(1, p.id)))?.clientId, null);
      const longClient = await runner.transaction(r => r.clients.create({ workspaceId: 1, name: 'L'.repeat(99) + '😀', notes: null, archived: false }));
      const longName = 'P'.repeat(252) + '😀';
      await makeProject(longName);
      const longProject = await makeProject(longName, longClient.id);
      await runner.transaction(r => r.clients.deleteAndDetachProjects(1, longClient.id));
      const renamedLong = (await runner.readSnapshot(r => r.projects.get(1, longProject.id)))!;
      assert.ok(renamedLong.name.length <= 255); assert.doesNotMatch(renamedLong.name, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      const tag = await runner.transaction(r => r.tags.create(1, 'urgent'));
      await connection.db.insertInto('time_entry_tags').values({ time_entry_id: 1, tag_id: tag.id }).execute();
      await runner.transaction(r => r.tags.delete(1, tag.id));
      assert.deepEqual(await connection.db.selectFrom('time_entry_tags').selectAll().execute(), []);
      await runner.transaction(r => r.projects.delete(1, p.id, 'detach'));
      assert.equal(await runner.readSnapshot(r => r.tasks.getRef(1, task.id)), undefined);
      const detached = await connection.db.selectFrom('time_entries').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(detached.project_id, null); assert.equal(detached.task_id, null); assert.equal(detached.deleted_at, null);
      const deletedProject = await makeProject('Delete');
      await connection.db.insertInto('time_entries').values({ ...row, id: 2000, project_id: deletedProject.id, task_id: null }).execute();
      await runner.transaction(r => r.projects.delete(1, deletedProject.id, 'delete'));
      const deleted = await connection.db.selectFrom('time_entries').selectAll().where('id', '=', 2000).executeTakeFirstOrThrow();
      assert.equal(deleted.project_id, null); assert.ok(deleted.deleted_at);
      const expired = await runner.transaction(async r => r);
      await assert.rejects(expired.tags.list(1), /context is closed/);
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}

async function explainCatalog(db: Kysely<PhysicalDatabase>, backend: Backend, pid: number, tid: number) {
  await sql.raw(backend === 'sqlite' ? 'ANALYZE' : backend === 'postgres' ? 'ANALYZE time_entries' : 'ANALYZE TABLE time_entries').execute(db);
  const queries = [
    ['project-ref', catalogProjectRefQuery(db, 1, pid)], ['task-ref', catalogTaskRefQuery(db, 1, tid)],
    ['project-total', catalogProjectQuery(db, backend).where('p.workspace_id', '=', 1).where('p.id', '=', pid)],
    ['task-total', catalogTaskQuery(db, backend).where('t.workspace_id', '=', 1).where('t.id', '=', tid)],
  ] as const;
  for (const [kind, query] of queries) {
    const compiled = query.compile();
    if (kind.endsWith('ref')) assert.doesNotMatch(compiled.sql, /time_entries|sum\(/i);
    const result = await db.executeQuery(CompiledQuery.raw(`${backend === 'sqlite' ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN'} ${compiled.sql}`, [...compiled.parameters]));
    const plan = JSON.stringify(result.rows);
    console.log(`${backend} ${kind} plan: ${plan}`);
    if (kind.endsWith('total')) assert.match(plan, new RegExp(`time_entries_${kind.startsWith('project') ? 'project' : 'task'}_live`));
    else assert.match(plan, /PRIMARY|INTEGER PRIMARY KEY|Index Scan|Index Only Scan|Bitmap Index Scan/i);
  }
}
