import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { sql } from 'kysely';
import { disposableBackend } from './support/disposableBackend.ts';
import { migrationChild } from './support/childProcess.ts';
import { openConnection, openReadConnection } from '../../src/storage/connections.ts';
import { initializeDatabase, migrate, migrations, verifyCurrent, validateEngine } from '../../src/storage/migrations.ts';
import { serverDDL, quote } from '../../src/storage/schema.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';

for(const backend of ['sqlite','postgres','mysql','mariadb'] as const) {
  test(`${backend}: advancement, readers, concurrent owners, failure, interruption and drift refusal`,{timeout:180000},async t=>{
    const fixture=await disposableBackend(backend);
    const latest=migrations(backend).at(-1)!.version;
    const next=latest+1;
    const future=next+10;
    let c=await openConnection<PhysicalDatabase>(fixture.config);
    try {
      t.diagnostic(`actual engine: ${await validateEngine(c)}`);
      if(backend!=='sqlite') {
        await sql`create table legacy_probe (value integer)`.execute(c.db);
        await sql`insert into legacy_probe values (42)`.execute(c.db);
        await assert.rejects(initializeDatabase(fixture.config),/unsupported-schema/);
        assert.equal(Number((await sql<{value:number}>`select value from legacy_probe`.execute(c.db)).rows[0]!.value),42);
        await sql`drop table legacy_probe`.execute(c.db);
      }
      const fresh=[migrationChild(fixture.config,'held-baseline'),migrationChild(fixture.config,'baseline')] as const;
      try {
        await Promise.all(fresh.map(child=>child.waitMessage('ready')));
        fresh[0].child.send('go');
        await fresh[0].waitMessage('ddl-applied');
        fresh[1].child.send('go');
        await setTimeout(200);
        assert.ok(!fresh[1].messages.includes('complete'));
        fresh[0].child.send('release');
        await Promise.all(fresh.map(child=>child.waitMessage('complete')));
        for(const child of fresh) assert.equal((await child.exited)[0],0);
      } finally { fresh.forEach(({child})=>child.kill('SIGKILL')); }
      await assert.rejects(verifyCurrent(c), /inconsistent-schema/);
      await c.db.insertInto('workspaces').values({name:'persisted',created_at:'2026-10-01T00:00:00.000Z',updated_at:'2026-10-01T00:00:00.000Z'}).execute();
      assert.equal((await c.db.selectFrom('storage_migrations').selectAll().execute()).length,1);
      await c.close();
      // Two independent processes/pools attempt the same upgrade, including a held lock.
      const children=[migrationChild(fixture.config,'held'),migrationChild(fixture.config,'concurrent')] as const;
      try {
        await Promise.all(children.map(child=>child.waitMessage('ready')));
        children[0].child.send('go');
        await children[0].waitMessage('ddl-applied');
        children[1].child.send('go');
        await setTimeout(200);
        assert.ok(!children[1].messages.includes('complete'), 'second owner must wait for the held database lock');
        children[0].child.send('release');
        await Promise.all(children.map(child=>child.waitMessage('complete')));
        for(const child of children) assert.equal((await child.exited)[0],0);
      } finally { children.forEach(({child})=>child.kill('SIGKILL')); }
      c=await initializeDatabase(fixture.config);
      assert.equal((await sql<{name:string}>`select name from workspaces`.execute(c.db)).rows[0]!.name,'persisted');
      assert.equal((await c.db.selectFrom('storage_migrations').selectAll().execute()).length,latest);
      const saved=await c.db.selectFrom('storage_migrations').selectAll().where('version','=',latest).executeTakeFirstOrThrow();
      await c.db.updateTable('storage_migrations').set({checksum:'tampered'}).where('version','=',latest).execute();
      await assert.rejects(verifyCurrent(c),/inconsistent-schema/);
      await assert.rejects(initializeDatabase(fixture.config),/inconsistent-schema/);
      await c.db.updateTable('storage_migrations').set({checksum:saved.checksum,version:future}).where('version','=',latest).execute();
      await assert.rejects(verifyCurrent(c),/inconsistent-schema/);
      await c.db.updateTable('storage_migrations').set({version:latest}).where('version','=',future).execute();
      await verifyCurrent(c);
      const reader=await openReadConnection<PhysicalDatabase>(fixture.config);
      try {
        await verifyCurrent(reader);
        await assert.rejects(migrate(reader),/reader/);
        await assert.rejects(sql`delete from workspaces`.execute(reader.db));
      } finally { await reader.close(); }
      const fault={version:next,name:'failure_probe',statements:['CREATE TABLE failure_probe (value INTEGER)','THIS IS INVALID DDL secret-password']};
      await assert.rejects(migrate(c,[...migrations(backend),fault]),error=>{
        assert.match(String(error),/migration-failed/);assert.doesNotMatch(String(error),/secret-password/);assert.equal((error as Error).cause,undefined);return true;
      });
      const ledger=await c.db.selectFrom('storage_migrations').selectAll().orderBy('version').execute();
      assert.equal(ledger.filter(row=>row.state==='complete').length,latest);
      if(serverDDL(backend)) {
        assert.equal(ledger.at(-1)!.state,'applying');
        assert.equal(ledger.at(-1)!.schema_hash,null);
        await sql`select * from failure_probe`.execute(c.db);
        await assert.rejects(migrate(c),/inconsistent-schema/);
        // Fixture-only repair to reuse this disposable database for the process-death test.
        await sql`drop table failure_probe`.execute(c.db);
        await c.db.deleteFrom('storage_migrations').where('version','=',next).execute();
      } else {
        assert.equal(ledger.length,latest);
        await assert.rejects(sql`select * from failure_probe`.execute(c.db));
      }
      await verifyCurrent(c);
      if(fixture.config.backend==='mysql' || fixture.config.backend==='mariadb') {
        const wrong={...fixture.config,backend:fixture.config.backend==='mysql'?'mariadb' as const:'mysql' as const};
        await assert.rejects(initializeDatabase(wrong),/unsupported-engine/);
        await verifyCurrent(c);
      }
      await c.close();
      const interrupted=migrationChild(fixture.config,'interrupt');
      try { await interrupted.waitMessage('ddl-applied'); }
      finally { interrupted.child.kill('SIGKILL'); await interrupted.exited; }
      c=await openConnection<PhysicalDatabase>(fixture.config);
      if(serverDDL(backend)) {
        await assert.rejects(initializeDatabase(fixture.config),/inconsistent-schema/);
        const dirty=await c.db.selectFrom('storage_migrations').selectAll().where('version','=',next).executeTakeFirstOrThrow();
        assert.equal(dirty.state,'applying'); assert.equal(dirty.schema_hash,null);
        await sql`select * from interruption_probe`.execute(c.db);
        await sql`drop table interruption_probe`.execute(c.db);
        await c.db.deleteFrom('storage_migrations').where('version','=',next).execute();
      } else {
        await verifyCurrent(c);
        assert.equal((await c.db.selectFrom('storage_migrations').selectAll().execute()).length,latest);
        await assert.rejects(sql`select * from interruption_probe`.execute(c.db));
      }
      await verifyCurrent(c);
      // An unexpected physical index is refused despite a complete ledger and unchanged versions.
      await sql.raw(`CREATE INDEX ${quote(backend,'unexpected_index')} ON time_entries(id)`).execute(c.db);
      await assert.rejects(verifyCurrent(c),/inconsistent-schema/);
      await assert.rejects(initializeDatabase(fixture.config),/inconsistent-schema/);
    } finally { await c.close(); await fixture.cleanup(); }
  });
}
