import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ImportResult } from '@tokkl/types';
import { exportFilename, importCounts, restoreErrorId, sameUsers, toggledUsers } from './transferForm.ts';

const result: ImportResult = {
  dry_run: true,
  rows: 10,
  created: 5,
  skipped_duplicates: 2,
  created_projects: [],
  created_clients: [],
  errors: [],
  users: [
    { key: 'a', user: 'Ana', email: 'ana@example.com', rows: 6 },
    { key: 'b', user: 'Ben', email: '', rows: 3 },
    { key: 'c', user: '', email: 'c@example.com', rows: 1 },
  ],
  skipped: [{ rows: 1, reason: 'Toggl user not selected' }],
};

test('exports are named after the UTC day', () => {
  const now = new Date('2026-11-07T23:30:00.000Z');
  assert.equal(exportFilename('json', now), 'tokkl-2026-11-07.json');
  assert.equal(exportFilename('csv', now), 'tokkl-entries-2026-11-07.csv');
});

test('rows not created, skipped or from other users are the failed ones', () => {
  assert.deepEqual(importCounts(result), { otherUsers: 1, failed: 2 });
  assert.equal(importCounts({ ...result, created: 9 }).failed, 0);
});

test('the chosen users keep the file order', () => {
  assert.deepEqual(toggledUsers(result.users, ['c'], 'a', true), ['a', 'c']);
  assert.deepEqual(toggledUsers(result.users, ['a', 'c'], 'a', false), ['c']);
});

test('a selection matches the previewed one only with the same users', () => {
  assert.equal(sameUsers(['a', 'c'], ['a', 'c']), true);
  assert.equal(sameUsers([], []), true);
  assert.equal(sameUsers(['a'], ['a', 'c']), false);
  assert.equal(sameUsers(['a', 'b'], ['a', 'c']), false);
});

test("a restore problem names the file's id as text, whatever JSON value it was", () => {
  assert.deepEqual(['abc', 9001, null, [1, 2], { toString: 1 }, undefined].map(restoreErrorId), [
    'abc',
    '9001',
    'null',
    '[1,2]',
    '{"toString":1}',
    '',
  ]);
});
