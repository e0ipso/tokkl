import assert from 'node:assert/strict';
import { sql } from 'kysely';
import type { Backend } from '../../../src/storage/config.ts';
import { insert, rows, type TestDb } from './schemaAssertions.ts';

export async function assertInvariants(db: TestDb, backend: Backend): Promise<void> {
  const times = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
  await insert(db,backend,'workspaces',{id:10,name:'scope',...times});
  await insert(db,backend,'workspaces',{id:11,name:'other',...times});
  await insert(db,backend,'users',{id:10,email:'owner',password_hash:'hash',api_token:'token',...times});
  const largeName='w'.repeat(1024);
  const largeJson=JSON.stringify({unknown_preference:'x'.repeat(70000)});
  await sql`update workspaces set name=${largeName} where id=10`.execute(db);
  await sql`update users set preferences=${largeJson} where id=10`.execute(db);
  assert.equal((await rows(db,backend,'workspaces')).find(row=>Number(row.id)===10)!.name,largeName);
  assert.equal((await rows(db,backend,'users')).find(row=>Number(row.id)===10)!.preferences,largeJson);
  for (const table of ['users','clients','projects','tasks','tags']) {
    let n=100;
    const nameColumn = table === 'users' ? 'email' : 'name';
    if(table === 'tasks') await insert(db,backend,'projects',{id:90,workspace_id:10,name:'task parent',color:'#fff',...times});
    const row = (value:string):Record<string,unknown> => ({id:n++, [nameColumn]:value, ...times,
      ...(table === 'users' ? {password_hash:'hash',api_token:`token-${n}`} : {workspace_id:10}),
      ...(table === 'projects' ? {color:'#fff'} : {}), ...(table === 'tasks' ? {project_id:90} : {})});
    for (const value of ['Alpha','Ä','ä','é','e','É','trail','trail ','%_wild','😀'.repeat(255)]) await insert(db,backend,table,row(value));
    await assert.rejects(insert(db,backend,table,row('ALPHA')), `${table} folds ASCII`);
    await assert.rejects(insert(db,backend,table,row('trail ')), `${table} preserves exact trailing space`);
    // Generated keys also follow updates, so read-check-write races cannot bypass uniqueness.
    await assert.rejects(sql`update ${sql.table(table)} set ${sql.ref(nameColumn)}='alpha' where id=101`.execute(db));
    if(table !== 'users' && table !== 'tasks') await insert(db,backend,table,{...row('Alpha'),workspace_id:11});
  }
  await insert(db,backend,'clients',{id:20,workspace_id:10,name:'client scope',...times});
  await insert(db,backend,'clients',{id:21,workspace_id:10,name:'other scope',...times});
  for (const [id,client_id] of [[30,null],[31,20],[32,21]] as const) await insert(db,backend,'projects',{id,client_id,workspace_id:10,name:'scoped',color:'#fff',...times});
  await assert.rejects(insert(db,backend,'projects',{id:33,workspace_id:10,client_id:null,name:'SCOPED',color:'#fff',...times}));
  await assert.rejects(insert(db,backend,'projects',{id:33,workspace_id:10,client_id:20,name:'SCOPED',color:'#fff',...times}));
  // Delete detaches a noncolliding client and recomputes its generated scope.
  await insert(db,backend,'projects',{id:40,workspace_id:10,client_id:20,name:'detach',color:'#fff',...times});
  await sql`delete from projects where id=31`.execute(db);
  await sql`delete from clients where id=20`.execute(db);
  await assert.rejects(insert(db,backend,'projects',{id:41,workspace_id:10,name:'DETACH',color:'#fff',...times}));
  const entry = {workspace_id:10,user_id:10,start:'2026-10-01T00:00:00.000Z',...times};
  await insert(db,backend,'time_entries',{id:10,...entry});
  await assert.rejects(insert(db,backend,'time_entries',{id:11,...entry}));
  await insert(db,backend,'time_entries',{id:12,...entry,stop:'2026-10-01T01:00:00.000Z'});
  await insert(db,backend,'time_entries',{id:13,...entry,deleted_at:'2026-10-01T01:00:00.000Z'});
  await assert.rejects(sql`update time_entries set stop=null where id=12`.execute(db));
  await assert.rejects(sql`update time_entries set deleted_at=null where id=13`.execute(db));
  await sql`update time_entries set stop='2026-10-01T01:00:00.000Z' where id=10`.execute(db);
  await sql`update time_entries set stop=null where id=12`.execute(db);
  assert.equal((await rows(db,backend,'time_entries')).filter(r=>r.stop===null&&r.deleted_at===null).length,1);
  await insert(db,backend,'workspace_users',{workspace_id:10,user_id:10,role:'owner'});
  await insert(db,backend,'pause_chains',{user_id:10,workspace_id:10,project_id:30,description:'pause',tag_ids_json:'[]',billable:0,seconds:1});
  await insert(db,backend,'time_entry_tags',{time_entry_id:10,tag_id:100});
  await sql`delete from workspaces where id in (10,11)`.execute(db);
  for(const table of ['clients','projects','tasks','tags','time_entries','pause_chains','workspace_users','time_entry_tags']) assert.equal((await rows(db,backend,table)).length,0,`${table} workspace cascade`);
}
