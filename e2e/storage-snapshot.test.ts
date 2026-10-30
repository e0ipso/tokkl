import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, addUser } from '../packages/api/test/helpers.ts';
import { snapshot } from '../desktop/kde/tests/storage-snapshot.ts';

test('desktop snapshots retain other accounts, memberships, live and deleted entries and ordered tags', async () => {
  const admin = await setup();
  const user = await addUser(admin, { email: 'snapshot@example.com', role: 'user' });
  const created = await user.json('POST', `/api/v9/workspaces/${user.wid}/time_entries`, {
    start: '2026-01-01T10:00:00Z', stop: '2026-01-01T11:00:00Z', tags: ['z', 'a'], billable: true,
  });
  assert.equal(created.status, 200);
  const id = created.body.id;
  const before = await snapshot(admin);
  assert.equal(before.users.length, 2);
  assert.equal(before.workspaces.length, 2);
  assert.equal(before.memberships.length, 2);
  assert.deepEqual(before.entries.map(row => [row.id, row.user_id, row.tags, row.billable, row.deleted_at]), [[id, user.user.id, ['a', 'z'], true, null]]);
  assert.equal((await user.json('DELETE', `/api/v9/workspaces/${user.wid}/time_entries/${id}`)).status, 200);
  const after = await snapshot(admin);
  assert.equal(after.entries.length, 1);
  assert.ok(after.entries[0]!.deleted_at);
  assert.deepEqual(after.users, before.users);
  assert.deepEqual(after.memberships, before.memberships);
});
