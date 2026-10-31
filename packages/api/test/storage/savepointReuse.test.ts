import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';

test('sequential import savepoints bound native statement creation and retain rollback-owned hooks', async t => {
 const c=await initializeDatabase({backend:'sqlite',filename:':memory:',busyTimeoutMs:100});
 t.after(()=>c.close());
 const controls:string[]=[],prepare=DatabaseSync.prototype.prepare;
 t.mock.method(DatabaseSync.prototype,'prepare',function(this:DatabaseSync,query:string){if(/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) /i.test(query))controls.push(query);return prepare.call(this,query);});
 const runner=createTransactionRunner(c,db=>({settings:{
  async put(key:string,value:string){await db.insertInto('instance_settings').values({key,value,updated_at:'2026-10-01T00:00:00.000Z',updated_by:null}).execute();},
  async get(key:string){return(await db.selectFrom('instance_settings').select('value').where('key','=',key).executeTakeFirst())?.value;},
 }}));
 const events:number[]=[];let succeeded=0;
 await runner.transaction(async ctx=>{
  for(let i=0;i<300;i++){
   const unit=()=>ctx.savepoint(async row=>{await row.settings.put('row-'+i,String(i));row.beforeCommit('settlement',async()=>{await row.settings.put('settled',String(i));});row.afterCommit(async()=>{events.push(i);});if(i%7===0)throw Error('discard row');});
   if(i%7===0)await assert.rejects(unit(),/discard row/);else{await unit();succeeded++;}
  }
  await assert.rejects(ctx.savepoint(async()=>ctx.savepoint(async()=>{})),/Savepoints must be sequential/);
 });
 assert.equal(events.length,succeeded);assert.ok(events.every(i=>i%7!==0));
 assert.equal(await runner.readSnapshot(r=>r.settings.get('row-0')),undefined);
 assert.equal(await runner.readSnapshot(r=>r.settings.get('row-1')),'1');
 assert.equal(await runner.readSnapshot(r=>r.settings.get('settled')),'299');
 assert.equal(controls.length,3,'many sequential rows must reuse native savepoint/release/rollback statements');
});
