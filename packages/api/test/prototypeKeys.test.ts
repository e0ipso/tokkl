import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageFor } from './fixtures/database.ts';
import { setup } from './helpers.ts';

/** `__proto__` stays an own key through JSON.parse. */
const PROTOTYPE_NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

test('prototype-named preference keys are stored and read like any other unknown key', async () => {
  const ctx = await setup();
  for (const path of ['/api/v9/me/preferences', '/api/app/me/preferences']) {
    for (const key of PROTOTYPE_NAMES) {
      // A JSON body, so `__proto__` arrives as an own key, as it does from a client.
      const body = `{"${key}": {"kept": "${path}"}, "custom_${key.replace(/_/g, '')}": 1}`;
      const saved = await ctx.request('POST', path, body);
      assert.equal(saved.status, 200, `${path} ${key}`);
      const answer = JSON.parse(await saved.text());
      assert.ok(Object.hasOwn(answer, key), `${path} ${key}`);
      assert.deepEqual(answer[key], { kept: path });
      const read = JSON.parse(await (await ctx.request('GET', path)).text());
      assert.deepEqual(read[key], { kept: path });
    }
  }
  const stored = (await storageFor(ctx.db).users.get(ctx.user.id))!.preferences;
  for (const key of PROTOTYPE_NAMES) assert.ok(Object.hasOwn(stored, key), key);
  const refused = await ctx.json('POST', '/api/v9/me/preferences', { constructor: 1, theme: 'neon' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body, 'Invalid theme: expected one of system, light, dark');
});

test('a prototype-named report grouping is refused like any unknown grouping', async () => {
  const ctx = await setup();
  const unknown = await ctx.json('POST', `/reports/api/v3/workspace/${ctx.wid}/summary/time_entries`, {
    start_date: '2026-10-05',
    grouping: 'nonsense',
  });
  assert.equal(unknown.status, 400);
  for (const name of PROTOTYPE_NAMES) {
    for (const [path, field] of [
      [`/reports/api/v3/workspace/${ctx.wid}/summary/time_entries`, 'grouping'],
      [`/reports/api/v3/workspace/${ctx.wid}/summary/time_entries`, 'sub_grouping'],
      ['/api/app/report', 'grouping'],
      ['/api/app/report/summary.csv', 'sub_grouping'],
    ] as const) {
      const response = await ctx.json('POST', path, { start_date: '2026-10-05', [field]: name });
      assert.equal(response.status, 400, `${path} ${field} ${name}`);
      assert.equal(response.body, unknown.body.replace("'grouping'", `'${field}'`));
    }
  }
});

test('a prototype-named JSON Patch path is refused like any unsupported path', async () => {
  const ctx = await setup();
  const url = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const entry = await ctx.json('POST', url, { start: '2026-10-01T08:00:00Z', duration: 600, description: 'kept' });
  for (const path of PROTOTYPE_NAMES) {
    const patched = await ctx.json('PATCH', `${url}/${entry.body.id}`, [{ op: 'replace', path, value: 'x' }]);
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body, {
      success: [],
      failure: [{ id: entry.body.id, message: `Unsupported path ${path}` }],
    });
  }
  assert.equal((await ctx.json('GET', `/api/v9/me/time_entries/${entry.body.id}`)).body.description, 'kept');
});
