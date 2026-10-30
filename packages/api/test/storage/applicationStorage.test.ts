import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStorageConfig } from '../../src/storage/config.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createStorage } from '../../src/storage/index.ts';

test('composed storage shares rollback, snapshots, dry runs and awaited closure', async () => {
  const config = parseStorageConfig({ TOKKL_DATABASE_URL: 'sqlite::memory:' }, '.');
  const storage = createStorage(await initializeDatabase(config));
  await storage.health();
  await storage.settings.write([{key:'timeResolutionMinutes',value:1,updatedAt:new Date().toISOString(),updatedBy:null}]);
  assert.equal((await storage.settings.read()).timeResolutionMinutes,1);
  let rolledBackId: number | undefined;
  await assert.rejects(storage.transaction(async ctx => {
    rolledBackId=(await ctx.workspaces.create('rolled back')).id;
    throw Error('rollback');
  }), /rollback/);
  assert.equal(await storage.workspaces.get(rolledBackId!), undefined);
  assert.equal(await storage.users.count(), 0);
  await storage.transaction(async ctx => {
    const ws = await ctx.workspaces.create('shared');
    await ctx.clients.create({ workspaceId: ws.id, name: 'client', notes: '', archived: false });
    assert.equal((await ctx.clients.list(ws.id)).length, 1);
  });
  let dryId: number | undefined;
  await storage.transaction(async ctx => { dryId=(await ctx.workspaces.create('dry')).id; }, { dryRun: true });
  assert.equal(await storage.workspaces.get(dryId!), undefined);
  await assert.rejects(storage.readSnapshot(r => r.workspaces.create('forbidden')));
  await storage.readSnapshot(async r => assert.equal(await r.users.count(), 0));
  await storage.close();
  await storage.close();
  await assert.rejects(storage.health());
});

test('storage closure drains active operations before releasing the underlying connection',async()=>{
 const storage=createStorage(await initializeDatabase(parseStorageConfig({TOKKL_DATABASE_URL:'sqlite::memory:'},'.')));
 let entered!:()=>void,release!:()=>void;
 const began=new Promise<void>(r=>{entered=r;}), barrier=new Promise<void>(r=>{release=r;});
 const work=storage.transaction(async ctx=>{entered();await barrier;await ctx.workspaces.create('committed before close');});
 const observed=work.catch(()=>{});await began;
 let closed=false;const closing=storage.close().then(()=>{closed=true;});
 try {await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await work;await closing;}
 finally{release();await Promise.allSettled([observed,closing]);}
 await assert.rejects(storage.health());
});
