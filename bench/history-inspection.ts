import { sql, type CompiledQuery } from 'kysely';
import { openConnection } from '../packages/api/src/storage/connections.ts';
import type { StorageConfig } from '../packages/api/src/storage/config.ts';
import type { PhysicalDatabase } from '../packages/api/src/storage/physical.ts';
import { catalogProjectQuery, catalogTaskQuery, catalogProjectRefQuery, catalogTaskRefQuery } from '../packages/api/src/storage/repositories/catalogs.ts';
import { createReportRepositories } from '../packages/api/src/storage/repositories/reports.ts';
import { createEntryRepositories } from '../packages/api/src/storage/repositories/entries.ts';
import { createTransactionRunner } from '../packages/api/src/storage/transactions.ts';
import { classifyHistoryPlan } from './history-plans.ts';

/** Inspect the actual populated application database after timings, using production query builders. */
export async function inspectHistory(config: StorageConfig, userId: number, wid: number, from: string, to: string) {
  const c = await openConnection<PhysicalDatabase>(config);
  try {
    const version = await sql<{ version: string }>`select ${sql.raw(config.backend === 'sqlite' ? 'sqlite_version()' : 'version()')} as version`.execute(c.db);
    // Freshly imported disposable data needs current statistics for a meaningful optimizer choice.
    for (const table of ['time_entries', 'projects', 'tasks']) {
      await sql.raw(config.backend === 'postgres' ? `ANALYZE ${table}` : config.backend === 'sqlite' ? `ANALYZE ${table}` : `ANALYZE TABLE ${table}`).execute(c.db);
    }
    const catalogRows: Record<string, number> = {};
    for (const table of ['projects', 'tasks'] as const) {
      const row = await c.db.selectFrom(table).select(c.db.fn.countAll().as('rows')).executeTakeFirstOrThrow();
      catalogRows[table] = Number(row.rows);
    }
    const project = await c.db.selectFrom('projects').select('id').where('workspace_id', '=', wid).orderBy('id').executeTakeFirstOrThrow();
    const task = await c.db.selectFrom('tasks').select('id').where('workspace_id', '=', wid).orderBy('id').executeTakeFirstOrThrow();
    const plans = [
      ['project totals', catalogProjectQuery(c.db, config.backend).where('p.workspace_id', '=', wid).compile(), 'time_entries_project_live'],
      ['task totals', catalogTaskQuery(c.db, config.backend).where('t.workspace_id', '=', wid).compile(), 'time_entries_task_live'],
      ['project write reference', catalogProjectRefQuery(c.db, wid, Number(project.id)).compile(), 'primary'],
      ['task write reference', catalogTaskRefQuery(c.db, wid, Number(task.id)).compile(), 'primary'],
    ] as const;
    const explain = [];
    for (const [name, query, expectedIndex] of plans) {
      const prefix = config.backend === 'sqlite' ? 'EXPLAIN QUERY PLAN ' : config.backend === 'postgres' ? 'EXPLAIN (FORMAT JSON) ' : 'EXPLAIN FORMAT=JSON ';
      const result = await c.db.executeQuery({ ...query, sql: prefix + query.sql });
      explain.push({ name, sql: query.sql, parameters: query.parameters, plan: result.rows, expected_index: expectedIndex,
        ...classifyHistoryPlan(config.backend, result.rows, expectedIndex, catalogRows) });
    }
    const pending = new Map<object, CompiledQuery>();
    const executed: Array<{ sql: string; parameters: readonly unknown[]; rows: number }> = [];
    const counted = c.db.withPlugin({
      transformQuery(args) {
        if (args.node.kind === 'SelectQueryNode') pending.set(args.queryId, c.db.getExecutor().compileQuery(args.node, args.queryId));
        return args.node;
      },
      async transformResult(args) {
        const query = pending.get(args.queryId);
        if (query) { executed.push({ sql: query.sql, parameters: query.parameters, rows: args.result.rows.length }); pending.delete(args.queryId); }
        return args.result;
      },
    });
    const operations = createTransactionRunner({ ...c, db: counted }, db => createReportRepositories(db, config.backend));
    const reportRows = await operations.readSnapshot(r => r.reports.collect(userId, wid, { from: `${from}T00:00:00.000Z`, to: `${to}T00:00:00.000Z` }));
    const report = { rows: reportRows.length, selects: executed.length, queries: executed.splice(0) };
    const entries = await createEntryRepositories(counted, config.backend).entries.list(userId, { from: `${from}T00:00:00.000Z`, to: `${to}T00:00:00.000Z` });
    const entryList = { rows: entries.length, selects: executed.length, queries: executed.splice(0) };
    return { version: version.rows[0]!.version, statistics: 'ANALYZE after timings, no optimizer overrides', catalog_rows: catalogRows,
      plan_assertion: 'chosen live-entry indexes; indexed or bounded small-catalog references; no full-history scans', explain, report, entry_list: entryList };
  } finally { await c.close(); }
}
