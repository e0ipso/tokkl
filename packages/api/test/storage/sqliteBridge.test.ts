import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Kysely, sql } from 'kysely';
import { NodeSqliteDialect } from '../../src/storage/sqliteBridge.ts';

interface Schema { items: { id: number; name: string; payload: Uint8Array | null } }
function database(filename = ':memory:', busyTimeoutMs = 100) {
  return new Kysely<Schema>({ dialect: new NodeSqliteDialect({ filename, busyTimeoutMs }) });
}
async function create(db: Kysely<Schema>) {
  await db.schema.createTable('items').addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', (col) => col.notNull()).addColumn('payload', 'blob').execute();
}

test('Node SQLite bridge binds parameters, returns insert rows/counts, streams and rolls back', async () => {
  const db = database();
  try {
    await create(db);
    const row = await db.insertInto('items').values({ id: 1, name: "it's bound ?", payload: new Uint8Array([1, 2]) }).returningAll().executeTakeFirstOrThrow();
    assert.deepEqual({ ...row }, { id: 1, name: "it's bound ?", payload: new Uint8Array([1, 2]) });
    const inserted = await db.insertInto('items').values({ id: 2, name: 'two', payload: null }).executeTakeFirstOrThrow();
    assert.equal(inserted.insertId, 2n);
    assert.equal(inserted.numInsertedOrUpdatedRows, 1n);
    await assert.rejects(db.transaction().execute(async (trx) => {
      await trx.insertInto('items').values({ id: 3, name: 'rollback', payload: null }).execute();
      throw new Error('rollback requested');
    }), /rollback requested/);
    assert.deepEqual((await db.selectFrom('items').select('id').orderBy('id').execute()).map((r) => r.id), [1, 2]);
    const streamed: number[] = [];
    for await (const item of db.selectFrom('items').select('id').orderBy('id').stream()) streamed.push(item.id);
    assert.deepEqual(streamed, [1, 2]);
    assert.equal((await db.updateTable('items').set({ name: 'changed' }).where('id', '=', 1).executeTakeFirstOrThrow()).numUpdatedRows, 1n);
    assert.equal((await db.deleteFrom('items').where('id', '=', 2).executeTakeFirstOrThrow()).numDeletedRows, 1n);
    await assert.rejects(sql`select 9007199254740992 as unsafe`.execute(db), /Invalid storage integer/);
  } finally { await db.destroy(); }
});

test('write transactions acquire the SQLite reserved lock before their first write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokkl-bridge-'));
  const filename = join(dir, 'test.sqlite');
  const db = database(filename);
  let other: DatabaseSync | undefined;
  try {
    await create(db);
    other = new DatabaseSync(filename);
    other.exec('PRAGMA busy_timeout = 1');
    await db.transaction().execute(async () => {
      assert.throws(() => other!.exec('BEGIN IMMEDIATE'), /locked/);
    });
    other.exec('BEGIN IMMEDIATE; ROLLBACK');
  } finally { other?.close(); await db.destroy(); rmSync(dir, { recursive: true, force: true }); }
});
