import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const applicationEntrypoint = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { disposableBackend } from './support/disposableBackend.ts';
import { databaseUrl, openTimerStream, startApi } from './support/apiProcess.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';
import type { TimerState } from '@tokkl/types';

for(const backend of ['sqlite','postgres','mysql','mariadb'] as const) {
 test(`${backend}: actual URL-only startup, HTTP, SSE, persistence, restart and active shutdown`,{timeout:180000},async t=>{
  const fixture=await disposableBackend(backend);t.after(()=>fixture.cleanup());
  const dir=mkdtempSync(join(tmpdir(),'tokkl-app-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let app=await startApi(databaseUrl(fixture.config),dir);t.after(()=>{if(app.child.exitCode===null)app.child.kill('SIGTERM');});
  let token='';
  async function request(method:string,path:string,body?:unknown,auth=true){return fetch(app.base+path,{method,headers:{'x-tokkl-csrf':'1',...(auth?{authorization:`Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
  async function json<T = unknown>(method:string,path:string,body?:unknown,auth=true){const r=await request(method,path,body,auth);const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value as T;}
  assert.deepEqual(await json('GET','/healthz',undefined,false),{ok:true});
  assert.deepEqual(await json('GET','/api/app/status',undefined,false),{setup_required:true});
  const setup=await request('POST','/api/app/setup',{email:'me@example.test',password:'correct horse battery',fullname:'App',timezone:'Europe/Madrid',setup_code:'TEST-CODE'},false);assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie')!.split(';')[0]!;
  const meResponse=await fetch(app.base+'/api/v9/me',{headers:{cookie}});assert.equal(meResponse.status,200);
  const me=await meResponse.json() as {id:number;api_token:string;default_workspace_id:number};token=me.api_token;const wid=me.default_workspace_id;
  const client=await json<{id:number}>('POST',`/api/v9/workspaces/${wid}/clients`,{name:'Client'});
  const project=await json<{id:number}>('POST',`/api/v9/workspaces/${wid}/projects`,{name:'Project',client_id:client.id});
  const task=await json<{id:number;estimated_seconds:number}>('POST',`/api/v9/workspaces/${wid}/projects/${project.id}/tasks`,{name:'Task',estimated_seconds:1.5});assert.equal(task.estimated_seconds,1.5);
  const events=await openTimerStream(app.base,token);t.after(()=>events.close());await events.until(()=>events.states.length===1);
  const initial=events.states[0]!.revision;
  const started=await json<{id:number}>('POST',`/api/v9/workspaces/${wid}/time_entries`,{start:new Date().toISOString(),project_id:project.id,task_id:task.id,tags:['z','a'],description:'persist'});
  await events.until(()=>events.states.some(s=>s.running_entry?.id===started.id));
  const before=await json<TimerState>('GET','/api/app/timer');
  const dry={format:'tokkl-export',time_entries:[{id:1,start:'2026-10-01T00:00:00Z',stop:'2026-10-01T00:05:00Z',description:'dry'}]};
  await json('POST','/api/app/import/json?dry_run=true',dry);
  assert.equal((await json<TimerState>('GET','/api/app/timer')).revision,before.revision);
  const invalid=await request('PUT',`/api/v9/workspaces/${wid}/time_entries/${started.id}`,{project_id:999999});assert.equal(invalid.status,404);
  assert.equal((await json<TimerState>('GET','/api/app/timer')).revision,before.revision);
  const stale=await request('POST','/api/app/timer/resume',{revision:initial});assert.equal(stale.status,409);assert.equal((await stale.json() as TimerState).revision,before.revision);
  await json('PUT',`/api/v9/workspaces/${wid}/projects/${project.id}`,{name:'Renamed'});await events.until(()=>events.states.some(s=>s.running_entry?.project_name==='Renamed'));
  const replacement=await json<string>('POST','/api/v9/me/reset_token');await events.until(events.ended);token=replacement;
  const storage=createStorage(await initializeDatabase(fixture.config));
  try {await storage.transaction(async ctx=>{for(let i=0;i<300;i++)await ctx.entries.create({workspaceId:wid,userId:me.id,projectId:project.id,taskId:task.id,description:`history ${i}`,start:'2026-10-01T00:00:00.000Z',stop:'2026-10-01T01:00:00.000Z',billable:false,allDay:false,durationOnly:false,createdWith:'test',deletedAt:null,tagIds:[]});});}finally{await storage.close();}
  const report=request('POST','/api/app/report/detailed.csv',{start_date:'2026-10-01',end_date:'2026-10-30'}).then(async r=>{assert.equal(r.status,200);assert.equal((await r.text()).split('\n').length,302);});
  const timer=await json<TimerState>('GET','/api/app/timer');assert.equal(timer.running_entry!.id,started.id);await report;
  const exported=await json<{time_entries:unknown[]}>('GET','/api/app/export.json');assert.equal(exported.time_entries.length,301);assert.ok(!JSON.stringify(exported).includes('password_hash'));
  const open=await openTimerStream(app.base,token);t.after(()=>open.close());await open.until(()=>open.states.length===1);
  const active=request('POST','/api/app/report/detailed.csv',{start_date:'2026-10-01',end_date:'2026-10-30'}).then(async r=>{await r.text();}).catch(()=>{});
  await app.stop();await active;await open.until(open.ended);
  const logs=app.logs();assert.ok(!logs.includes('Unhandled'));if(fixture.config.backend!=='sqlite')assert.ok(!logs.includes(fixture.config.password));console.log(`${backend} first lifecycle: ${logs.trim()}`);
  app=await startApi(databaseUrl(fixture.config),dir);
  assert.deepEqual(await json('GET','/api/app/status',undefined,false),{setup_required:false});assert.equal((await json<TimerState>('GET','/api/app/timer')).running_entry!.description,'persist');assert.equal((await json<{time_entries:unknown[]}>('GET','/api/app/export.json')).time_entries.length,301);
  const revisions=events.states.map(s=>s.revision);assert.ok(revisions.every((value,i)=>i===0||value>revisions[i-1]!));
  await app.stop();console.log(`${backend} restart lifecycle: ${app.logs().trim()}`);
 });
}
test('actual startup refuses unreachable explicit URLs and legacy defaults without fallback or mutation',{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tokkl-refuse-'));
 try {for(const mode of ['unreachable','legacy'] as const){if(mode==='legacy')writeFileSync(join(dir,'timetrack.sqlite'),'untouched legacy');const env:NodeJS.ProcessEnv={...process.env,TOKKL_DATA_DIR:dir,...(mode==='unreachable'?{TOKKL_DATABASE_URL:'postgres://user:secret@127.0.0.1:1/db?sslmode=disable&connect_timeout_ms=100'}:{})};delete env.TOKKL_DATABASE;delete env.TIMETRACK_DATABASE;if(mode==='legacy')delete env.TOKKL_DATABASE_URL;const child=spawn(process.execPath,[applicationEntrypoint],{env});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const [exit]=await once(child,'exit');assert.equal(exit,1);assert.ok(!logs.includes('secret'));assert.deepEqual(readdirSync(dir),mode==='legacy'?['timetrack.sqlite']:[]);if(mode==='legacy')assert.equal(readFileSync(join(dir,'timetrack.sqlite'),'utf8'),'untouched legacy');}}
 finally{rmSync(dir,{recursive:true,force:true});}
});
