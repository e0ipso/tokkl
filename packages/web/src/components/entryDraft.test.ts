import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_DRAFT, draftOf, draftSignature, editsSince } from './useEntryFields.ts';

const base = { description: 'Plan', project_id: 3, task_id: 7, tags: ['a'], billable: true };

test('draftOf keeps only the draft fields and copies the tags', () => {
  const source = { ...base, id: 9, start: '2026-10-20T09:00:00Z' };
  const draft = draftOf(source);
  assert.deepEqual(draft, base);
  assert.notEqual(draft.tags, source.tags);
});

test('editsSince lists changed fields, and a project change carries its task', () => {
  assert.deepEqual(editsSince(base, base), {});
  assert.deepEqual(editsSince(base, { ...base, description: 'Build' }), { description: 'Build' });
  assert.deepEqual(editsSince(base, { ...base, project_id: 4 }), { project_id: 4, task_id: 7 });
  assert.deepEqual(editsSince(base, { ...base, tags: ['a', 'b'], billable: false }), {
    tags: ['a', 'b'],
    billable: false,
  });
});

test('draftSignature changes with every mirrored field and is null without a source', () => {
  assert.equal(draftSignature(null), null);
  const signature = draftSignature(base);
  assert.equal(draftSignature({ ...base }), signature);
  for (const changed of [
    { description: 'Build' },
    { project_id: 4 },
    { task_id: null },
    { tags: ['b'] },
    { billable: false },
  ]) {
    assert.notEqual(draftSignature({ ...base, ...changed }), signature);
  }
  assert.notEqual(draftSignature(EMPTY_DRAFT), signature);
});
