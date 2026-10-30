import assert from 'node:assert/strict';
import { sql, type Kysely } from 'kysely';
import type { Backend } from '../../../src/storage/config.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';
import { baselineTables, baselineIndexes, totalsIndexes, quote, serverDDL } from '../../../src/storage/schema.ts';

export type TestDb = Kysely<PhysicalDatabase>;
export async function insert(db: TestDb, backend: Backend, table: string, row: Record<string, unknown>): Promise<void> {
  await sql`INSERT INTO ${sql.raw(quote(backend, table))} (${sql.join(Object.keys(row).map(key => sql.raw(quote(backend, key))))}) VALUES (${sql.join(Object.values(row))})`.execute(db);
}
export async function rows(db: TestDb, backend: Backend, table: string): Promise<Record<string, unknown>[]> {
  return (await sql.raw<Record<string, unknown>>(`select * from ${quote(backend, table)}`).execute(db)).rows;
}
export async function seed(db: TestDb, backend: Backend): Promise<void> {
  for (const [table, columns] of Object.entries(baselineTables)) {
    const row: Record<string, unknown> = {};
    for (const [name, column] of Object.entries(columns)) {
      if (column.default !== undefined || column.nullable) continue;
      row[name] = column.choices?.[0] ?? (['integer', 'id', 'real'].includes(column.type) ? 1 : column.type === 'instant' ? '2026-10-01T00:00:00.000Z' : `${table}_${name}`);
    }
    await insert(db, backend, table, row);
  }
}
export async function assertSchema(db: TestDb, backend: Backend): Promise<void> {
  for (const [table, columns] of Object.entries(baselineTables)) {
    const q = quote(backend, table);
    const actual = backend === 'sqlite' ? (await sql.raw<{ name: string; notnull: number; dflt_value: string | null; type: string; hidden: number }>(`PRAGMA table_xinfo(${q})`).execute(db)).rows.map(c => ({ name: c.name, type: c.type.toLowerCase(), nullable: c.notnull === 0, default: c.dflt_value }))
      : (await sql<{ name: string; nullable: string; type: string; default: string | null }>`select column_name as name, data_type as type, is_nullable as nullable, column_default as ${sql.raw(quote(backend, 'default'))} from information_schema.columns where table_schema=${backend === 'postgres' ? sql`current_schema()` : sql`database()`} and table_name=${table}`.execute(db)).rows.map(c => ({ ...c, nullable: c.nullable === 'YES' }));
    for (const [name, expected] of Object.entries(columns)) {
      const column = actual.find(c => c.name === name);
      assert.ok(column, `${backend} ${table}.${name} exists`);
      assert.ok((['integer','id'].includes(expected.type) ? ['integer','bigint'] : expected.type === 'real' ? ['real','double','double precision'] : ['text','longtext','varchar','character varying']).includes(column.type), `${table}.${name} physical type: ${column.type}`);
      assert.equal(column.nullable, expected.nullable ?? false, `${table}.${name} nullability`);
      if (expected.default !== undefined) {
        const normalized = String(column.default).replace(/::[a-z ]+/g, '').replace(/_utf8mb4/g, '').replace(/[()'\\]/g, '');
        assert.equal(normalized, expected.default.replaceAll("'", ''), `${table}.${name} default`);
      }
    }
    assert.equal(actual.length, Object.keys(columns).length + (['users','clients','projects','tasks','tags'].includes(table) ? 1 : 0) + (table === 'projects' ? 1 : 0) + (table === 'time_entries' && serverDDL(backend) ? 1 : 0));
  }
  for (const index of [...baselineIndexes, ...totalsIndexes, { name: 'time_entries_running', table: 'time_entries', columns: [serverDDL(backend) ? 'running_user_id' : 'user_id'], unique: true }]) {
    if (backend === 'sqlite') {
      const indexes = (await sql.raw<{ name: string; unique: number }>(`PRAGMA index_list(${quote(backend,index.table)})`).execute(db)).rows;
      assert.equal(indexes.find(i => i.name === index.name)?.unique, index.unique ? 1 : 0, index.name);
      const info = (await sql.raw<{ name: string }>(`PRAGMA index_info(${quote(backend,index.name)})`).execute(db)).rows;
      assert.deepEqual(info.map(c => c.name), index.columns);
    } else if (backend === 'postgres') {
      const info = (await sql<{ indexdef: string }>`select indexdef from pg_indexes where schemaname=current_schema() and indexname=${index.name}`.execute(db)).rows;
      assert.equal(info.length, 1, index.name);
      assert.equal(info[0]!.indexdef.includes('UNIQUE'), Boolean(index.unique), index.name);
      assert.ok(info[0]!.indexdef.includes(`(${index.columns.join(', ')})`), info[0]!.indexdef);
    } else {
      const info = (await sql<{ column_name: string; non_unique: number }>`select column_name as column_name, non_unique as non_unique from information_schema.statistics where table_schema=database() and table_name=${index.table} and index_name=${index.name} order by seq_in_index`.execute(db)).rows;
      assert.deepEqual(info.map(c => c.column_name), index.columns, index.name);
      assert.equal(Number(info[0]!.non_unique), index.unique ? 0 : 1);
    }
  }
}
export async function assertDefaultsAndForeignKeys(db: TestDb, backend: Backend): Promise<void> {
  await seed(db, backend);
  for (const [table, columns] of Object.entries(baselineTables)) {
    const row = (await rows(db, backend, table))[0]!;
    for (const [name, c] of Object.entries(columns)) {
      if (c.nullable) assert.equal(row[name], null, `${table}.${name} defaults NULL`);
      else if (c.default !== undefined) assert.equal(String(row[name]), c.default.replaceAll("'", ''), `${table}.${name} default inserted`);
      if (c.references) await assert.rejects(sql`update ${sql.raw(quote(backend,table))} set ${sql.raw(quote(backend,name))}=99999`.execute(db), `${table}.${name} rejects orphan`);
      if (!c.nullable && c.type !== 'id') await assert.rejects(sql`update ${sql.raw(quote(backend,table))} set ${sql.raw(quote(backend,name))}=null`.execute(db), `${table}.${name} rejects null`);
      if (c.choices) await assert.rejects(sql`update ${sql.raw(quote(backend,table))} set ${sql.raw(quote(backend,name))}='invalid'`.execute(db), `${table}.${name} checks values`);
      if (c.choices) await assert.rejects(sql`update ${sql.raw(quote(backend,table))} set ${sql.raw(quote(backend,name))}=${c.choices[0] + ' '}`.execute(db), `${table}.${name} rejects padded choice`);
    }
  }
  // Populate every optional FK, then exercise all detach and cascade paths with actual rows.
  await sql`update projects set client_id=1`.execute(db);
  await sql`update time_entries set project_id=1, task_id=1`.execute(db);
  await sql`update pause_chains set project_id=1, task_id=1`.execute(db);
  await sql`update instance_settings set updated_by=1`.execute(db);
  await sql`update account_tokens set created_by=1`.execute(db);
  await sql`delete from clients where id=1`.execute(db);
  assert.equal((await rows(db,backend,'projects'))[0]!.client_id,null);
  await sql`delete from projects where id=1`.execute(db);
  assert.equal((await rows(db,backend,'tasks')).length,0);
  for (const table of ['time_entries','pause_chains']) { const row = (await rows(db,backend,table))[0]!; assert.equal(row.project_id,null); assert.equal(row.task_id,null); }
  await sql`delete from tags where id=1`.execute(db);
  assert.equal((await rows(db,backend,'time_entry_tags')).length,0);
  await sql`delete from users where id=1`.execute(db);
  for (const table of ['sessions','workspace_users','time_entries','pause_chains','timer_states','pomodoro_sessions']) assert.equal((await rows(db,backend,table)).length,0,table);
  assert.equal((await rows(db,backend,'instance_settings'))[0]!.updated_by,null);
  assert.equal((await rows(db,backend,'account_tokens'))[0]!.created_by,null);
  // user_id on account tokens cascades, while created_by above detaches.
  await insert(db,backend,'users',{ id:2, email:'second',password_hash:'hash',api_token:'second',created_at:'now',updated_at:'now' });
  await sql`update account_tokens set user_id=2`.execute(db);
  await sql`delete from users where id=2`.execute(db);
  assert.equal((await rows(db,backend,'account_tokens')).length,0);
  await sql`delete from workspaces where id=1`.execute(db);
  assert.equal((await rows(db,backend,'projects')).length,0);
}
