import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompiledQuery } from 'kysely';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import { createEntryRepositories } from '../../src/storage/repositories/entries.ts';
import { createTimerRepositories } from '../../src/storage/repositories/timers.ts';
import { createTransferRepositories } from '../../src/storage/repositories/transfers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { entryAccount } from './support/entry-timer.ts';

function chosenRunningIndex(backend: string, value: unknown): boolean {
 if (typeof value === 'string') {
  try { return chosenRunningIndex(backend,JSON.parse(value)); } catch { return false; }
 }
 if (Array.isArray(value)) return value.some(v=>chosenRunningIndex(backend,v));
 if (!value || typeof value !== 'object') return false;
 const row=value as Record<string,unknown>;
 if (backend==='sqlite' && typeof row.detail==='string' && /USING (?:COVERING )?INDEX time_entries_running\b/.test(row.detail)) return true;
 if ((backend==='mysql'||backend==='mariadb') && ['e','time_entries'].includes(String(row.table_name))
  && row.key==='time_entries_running' && ['const','eq_ref','ref','range','index'].includes(String(row.access_type))) return true;
 if (backend==='postgres' && row['Relation Name']==='time_entries' && row['Index Name']==='time_entries_running') return true;
 return Object.values(row).some(v=>chosenRunningIndex(backend,v));
}
for(const backend of ['sqlite','postgres','mysql','mariadb'] as const) {
 test(`${backend}: current timer and affected-user lookups select the live-entry index`,{timeout:180000},async t=>{
  const fixture=await disposableBackend(backend);t.after(()=>fixture.cleanup());
  const c=await initializeDatabase(fixture.config),storage=createStorage(c);t.after(()=>storage.close());
  const user=await storage.transaction(ctx=>ctx.users.createAccount(entryAccount('running-access')));
  const input={userId:user.id,workspaceId:user.defaultWorkspaceId,projectId:null,taskId:null,description:'live',start:'2026-10-01T10:00:00.000Z',stop:null,billable:false,allDay:false,durationOnly:true,createdWith:'test',deletedAt:null,tagIds:[]};
  const at='2026-10-01T00:00:00.000Z';
  for(let offset=0;offset<3000;offset+=400) await c.db.insertInto('time_entries').values(Array.from({length:Math.min(400,3000-offset)},(_,i)=>({workspace_id:user.defaultWorkspaceId,user_id:user.id,project_id:null,task_id:null,description:`history ${offset+i}`,start:at,stop:'2026-10-01T01:00:00.000Z',billable:0,duronly:1,all_day:0,created_with:'test',deleted_at:null,created_at:at,updated_at:at}))).execute();
  const id=await storage.entries.insert(input);let captured:CompiledQuery[]=[];
  const db=c.db.withPlugin({transformQuery(args){if(args.node.kind==='SelectQueryNode') captured.push(c.db.getExecutor().compileQuery(args.node,args.queryId));return args.node;},async transformResult(args){return args.result;}});
  const {entries}=createEntryRepositories(db,backend),{timers}=createTimerRepositories(db,backend),{transfers}=createTransferRepositories(db,backend);
  const operations=[['entry running',async()=>assert.equal((await entries.running(user.id))?.id,id)],['transfer running',async()=>assert.equal(await transfers.hasRunningEntry(user.id),true)],['affected users',async()=>assert.deepEqual(await timers.affectedUsers(user.defaultWorkspaceId),[user.id])]] as const;
  for(const [name,work] of operations){captured=[];await work();const query=captured.find(q=>/from ["`]time_entries["`]/.test(q.sql));assert.ok(query);
   const prefix=backend==='sqlite'?'EXPLAIN QUERY PLAN ':backend==='postgres'?'EXPLAIN (FORMAT JSON) ':'EXPLAIN FORMAT=JSON ';
   const plan=(await c.db.executeQuery({...query,sql:prefix+query.sql})).rows;
   t.diagnostic(JSON.stringify({name,sql:query.sql,plan}));assert.ok(chosenRunningIndex(backend,plan),`${name} must choose time_entries_running rather than visit historical entries`);
  }
  await storage.entries.softDelete(user.id,user.defaultWorkspaceId,id,new Date().toISOString());
  assert.equal(await entries.running(user.id),undefined);assert.equal(await transfers.hasRunningEntry(user.id),false);assert.deepEqual(await timers.affectedUsers(user.defaultWorkspaceId),[]);
 });
}
