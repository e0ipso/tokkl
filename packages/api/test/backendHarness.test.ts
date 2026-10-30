import { setup } from './helpers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, storageFor } from './fixtures/database.ts';

test('fixture identities expose storage without synchronous driver methods and isolate writes', async () => {
  const first = await openDatabase();
  const second = await openDatabase();
  assert.equal('prepare' in first, false);
  assert.equal('exec' in first, false);
  await storageFor(first).workspaces.create('Only first');
  assert.equal(await storageFor(second).users.count(), 0);
  assert.equal(await storageFor(second).workspaces.get(1), undefined);
});

test('fixtures refuse operator targets before opening any storage', async () => {
  for (const key of ['TOKKL_DATABASE_URL','TOKKL_TEST_DATABASE_URL']) {
    const previous=process.env[key];
    process.env[key]='postgres://operator:do-not-use@127.0.0.1/production';
    try { await assert.rejects(openDatabase(), /Operator database targets are forbidden/); }
    finally { if(previous===undefined) delete process.env[key]; else process.env[key]=previous; }
  }
});


test('SQLite physical tag allocation reuses a deleted maximum identifier', async () => {
  const ctx = await setup({ sqlite: true });
  const tags = `/api/v9/workspaces/${ctx.wid}/tags`;
  await ctx.json('POST', tags, { name: 'kept' });
  const deleted = await ctx.json('POST', tags, { name: 'deleted' });
  assert.equal(deleted.status, 200);
  assert.equal((await ctx.json('DELETE', `${tags}/${deleted.body.id}`)).status, 200);
  const replacement = await ctx.json('POST', tags, { name: 'replacement' });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.id, deleted.body.id);
});
