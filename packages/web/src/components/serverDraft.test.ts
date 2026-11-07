import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasEdits, mergedDraft, unstoredEdits, withEdit } from './serverDraft.ts';

interface Form {
  name: string;
  days: string;
}

const server: Form = { name: 'Tokkl', days: '30' };

test('the draft shows the server values under the edits', () => {
  assert.deepEqual(mergedDraft(server, { days: '7' }), { name: 'Tokkl', days: '7' });
  assert.deepEqual(mergedDraft({ ...server, name: 'Renamed elsewhere' }, { days: '7' }), {
    name: 'Renamed elsewhere',
    days: '7',
  });
});

test('a value set back to the server one is no longer an edit', () => {
  const edited = withEdit({}, server, false, 'days', '7');
  assert.deepEqual(edited, { days: '7' });
  assert.equal(hasEdits(edited), true);
  const reverted = withEdit(edited, server, false, 'days', '30');
  assert.deepEqual(reverted, {});
  assert.equal(hasEdits(reverted), false);
});

test('while saving, a value equal to the server one stays an edit', () => {
  assert.deepEqual(withEdit({ days: '7' }, server, true, 'days', '30'), { days: '30' });
});

test('after a save, edits the server now holds go and the rest stay', () => {
  const stored: Form = { name: 'Tokkl', days: '7' };
  const isStored = <K extends keyof Form>(key: K, value: Form[K]) => Object.is(stored[key], value);
  // "30" was the value before the save; typed during it, it is still an edit.
  assert.deepEqual(unstoredEdits<Form>({ days: '7', name: 'Typed meanwhile' }, isStored), {
    name: 'Typed meanwhile',
  });
  assert.deepEqual(unstoredEdits<Form>({ days: '30' }, isStored), { days: '30' });
});
