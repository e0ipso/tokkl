import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStorage } from '../../src/storage/index.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';
import { createApp } from '../../src/app.ts';
import { testConfig, testServer, setup, addUser } from '../helpers.ts';
import { addWorkspaceMember } from '../fixtures/domain.ts';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
test('credentials revoked after HTTP authentication cannot authorize an entry write',async t=>{
 const storage=createStorage(await initializeDatabase({backend:'sqlite',filename:':memory:',busyTimeoutMs:5000}));
 const accounts=createAccountOperations(storage,{recheckUser:async()=>{}});
 const user=await accounts.createFirstAdmin({email:'me@example.test',password:'correct horse battery',fullname:'Me',timezone:'UTC'});
 const entered=gate(),release=gate();let intercept=true;
 const app=createApp({storage:{...storage,transaction:async(work,options)=>{if(intercept){intercept=false;entered.resolve();await release.promise;}return storage.transaction(work,options);}},config:testConfig(),setup:{code:null}});
 t.after(async()=>{release.resolve();await app.locals.close();await storage.close();});
 const server=testServer(app);
 const request=server.request(`/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${user.apiToken}:api_token`).toString('base64')}`},body:JSON.stringify({start:'2026-10-30T12:00:00Z',description:'stale'})});
 await entered.promise;await accounts.rotateApiToken(user,{kind:'api-token',token:user.apiToken});release.resolve();
 const result=await request;assert.equal(result.status,403);assert.equal(await result.json(),'Incorrect username and/or password');assert.equal((await storage.entries.list(user.id)).length,0);
});
test('a catalog actor and every affected timer owner lock together in sorted order',async()=>{
 const owner=await setup();const actor=await addUser(owner,{email:'actor@example.test',role:'user'});
 await addWorkspaceMember(owner.db,owner.wid,actor.user.id,'member');
 const base=`/api/v9/workspaces/${owner.wid}`;
 const project=(await owner.json('POST',base+'/projects',{name:'Before'})).body;
 assert.equal((await owner.json('POST',base+'/time_entries',{start:'2026-10-30T12:00:00Z',project_id:project.id})).status,200);
 const result=await actor.json('PUT',base+`/projects/${project.id}`,{name:'After'});assert.equal(result.status,200);
 assert.equal((await owner.json('GET','/api/app/timer')).body.running_entry.project_name,'After');
});
test('independent PostgreSQL timer owners can write while another owner holds its guards',{timeout:30000},async t=>{
 const {disposableBackend}=await import('./support/disposableBackend.ts');const fixture=await disposableBackend('postgres');t.after(()=>fixture.cleanup());
 const storage=createStorage(await initializeDatabase(fixture.config));t.after(()=>storage.close());
 const users=await storage.transaction(async ctx=>{const out=[];for(const name of ['owner','other'])out.push(await ctx.users.createAccount({email:`${name}@example.test`,fullName:name,passwordHash:'hash',apiToken:name,timezone:'UTC',role:'admin',preferences:{}}));return out;});
 const app=createApp({storage,config:{...testConfig(),storage:fixture.config},setup:{code:null}});t.after(()=>app.locals.close());
 const {createTimeEntry}=await import('../../src/domain/timeEntries.ts');const entered=gate(),release=gate();
 const owner=users[0]!,other=users[1]!;
 const held=app.locals.services.entryWrite({user:owner,credential:{kind:'api-token',token:owner.apiToken},authMethod:'basic'},async(ctx:import('../../src/storage/contracts.ts').TransactionContext)=>{await createTimeEntry(ctx,owner,owner.defaultWorkspaceId,{start:'2026-10-30T12:00:00Z'},app.locals.services.publish);entered.resolve();await release.promise;});
 try {await entered.promise;const server=testServer(app);const response=server.request(`/api/v9/workspaces/${other.defaultWorkspaceId}/time_entries`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${other.apiToken}:api_token`).toString('base64')}`},body:JSON.stringify({start:'2026-10-30T12:00:00Z'})});let timer:NodeJS.Timeout|undefined;try{const result=await Promise.race([response,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('unrelated owner blocked on global guard')),2000);})]);assert.equal(result.status,200);}finally{clearTimeout(timer);}}finally{release.resolve();await held;}
});
