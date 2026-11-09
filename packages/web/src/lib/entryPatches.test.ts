import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Favorite } from '@tokkl/types';
import { MAX_FAVORITES, entryPatch, withFavorite } from './entryPatches.ts';

test('a project change replaces the task with it', () => {
  assert.deepEqual(entryPatch.project(3, null), [
    { op: 'replace', path: '/project_id', value: 3 },
    { op: 'replace', path: '/task_id', value: null },
  ]);
});

test('tags are replaced from a row and added from the bulk bar', () => {
  assert.deepEqual(entryPatch.tags(['a']), [{ op: 'replace', path: '/tags', value: ['a'] }]);
  assert.deepEqual(entryPatch.addTags(['a']), [{ op: 'add', path: '/tags', value: ['a'] }]);
});

test('a favorite is pinned last until every number key is taken', () => {
  const favorite: Favorite = { description: 'Write', project_id: null, task_id: null, tags: [], billable: false };
  assert.deepEqual(withFavorite([], favorite), [favorite]);
  assert.equal(
    withFavorite(
      Array.from({ length: MAX_FAVORITES }, () => favorite),
      favorite,
    ),
    null,
  );
});
