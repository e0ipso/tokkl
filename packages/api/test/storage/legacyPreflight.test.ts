import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { openDatabase } from '../../src/db/index.ts';

for (const mode of ['delete', 'wal', 'pragma-only', 'application-only', 'view-only', 'unknown']) {
  test(`SQLite ${mode} legacy refusal preserves bytes, data, PRAGMAs and sidecars`, async () => {
    const dir=mkdtempSync(join(tmpdir(),'tokkl-legacy-'));
    const filename=join(dir,'legacy.sqlite');
    let db: DatabaseSync | undefined;
    try {
      if(mode==='wal') db=openDatabase(filename);
      else {
        db=new DatabaseSync(filename);
        if(mode==='pragma-only') db.exec('PRAGMA user_version=7');
        else if(mode==='application-only') db.exec('PRAGMA application_id=123');
        else if(mode==='view-only') db.exec('CREATE VIEW legacy_view AS SELECT 1 AS value');
        else db.exec('CREATE TABLE legacy_data(value TEXT); INSERT INTO legacy_data VALUES (\'keep me\')');
        if(mode==='delete') db.exec('PRAGMA user_version=3; PRAGMA application_id=123; PRAGMA journal_mode=DELETE');
      }
      const snapshot=()=>Object.fromEntries(readdirSync(dir).sort().map(name=>[name,readFileSync(join(dir,name))]));
      const pragmas=db.prepare('PRAGMA user_version').get();
      const schema=db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all();
      const before=snapshot();
      await assert.rejects(initializeDatabase({backend:'sqlite',filename,busyTimeoutMs:5000}), /unsupported-schema/);
      assert.deepEqual(snapshot(),before);
      assert.deepEqual(db.prepare('PRAGMA user_version').get(),pragmas);
      assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all(),schema);
      if(mode==='delete'||mode==='unknown') assert.equal(db.prepare('SELECT value FROM legacy_data').get()!.value,'keep me');
    } finally { db?.close(); rmSync(dir,{recursive:true,force:true}); }
  });
}
