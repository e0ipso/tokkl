import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bulkEditMessage, deleteMessage } from './entryMessages.ts';

const failed = { success: [1], failure: [{ id: 2, message: 'Entry not found' }] };

test('a bulk-bar edit counts its failures, a row edit shows the first one alone', () => {
  assert.deepEqual(bulkEditMessage(failed, 'Tags added'), { text: '1 entries failed: Entry not found', kind: 'error' });
  assert.deepEqual(bulkEditMessage(failed, undefined), { text: 'Entry not found', kind: 'error' });
});

test('a successful bulk edit says so only from the bulk bar', () => {
  const ok = { success: [1, 2], failure: [] };
  assert.deepEqual(bulkEditMessage(ok, 'Marked billable'), { text: 'Marked billable', kind: 'info' });
  assert.equal(bulkEditMessage(ok, undefined), null);
});

test('deleteMessage counts what went and what failed', () => {
  assert.deepEqual(deleteMessage(1, 1, null), { text: 'Entry deleted', kind: 'info' });
  assert.deepEqual(deleteMessage(3, 3, null), { text: '3 entries deleted', kind: 'info' });
  assert.deepEqual(deleteMessage(3, 2, 'Gone'), { text: '2 entries deleted, 1 entry failed: Gone', kind: 'error' });
  assert.deepEqual(deleteMessage(2, 0, 'Gone'), { text: '2 entries failed: Gone', kind: 'error' });
  assert.deepEqual(deleteMessage(1, 0, 'Gone'), { text: 'Gone', kind: 'error' });
});
