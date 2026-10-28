import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barSeconds, pauseDraft } from './pauseView.ts';
import type { TimerPause } from '../api/types.ts';

const T0 = Date.parse('2026-10-19T10:00:00Z');
const minutes = (n: number) => n * 60_000;

function pause(overrides: Partial<TimerPause> = {}): TimerPause {
  return {
    paused: true, seconds: 600, workspace_id: 1, description: 'Write the spec', project_id: 4, task_id: 9,
    tag_ids: [2, 3], tags: ['docs', 'web'], billable: true, clone_entry_id: null, ...overrides,
  };
}

const clone = { id: 2, start: new Date(T0 + minutes(15)).toISOString() };

test('a paused bar shows the stored seconds, frozen whatever the clock says', () => {
  assert.equal(barSeconds(null, pause(), T0 + minutes(10)), 600);
  assert.equal(barSeconds(null, pause(), T0 + minutes(90)), 600);
});

test('a running clone adds its time since its start to the stored seconds', () => {
  const running = pause({ paused: false, clone_entry_id: 2 });
  assert.equal(barSeconds(clone, running, T0 + minutes(15)), 600);
  assert.equal(barSeconds(clone, running, T0 + minutes(20) + 7_900), 600 + 5 * 60 + 7);
});

test('a clone start ahead of the corrected clock counts as zero elapsed, not negative', () => {
  assert.equal(barSeconds(clone, pause({ paused: false, clone_entry_id: 2 }), T0), 600);
});

test('a running entry that is not the chain clone shows its own time', () => {
  const other = { id: 9, start: new Date(T0).toISOString() };
  assert.equal(barSeconds(other, pause({ paused: false, clone_entry_id: 2 }), T0 + minutes(3)), 180);
  assert.equal(barSeconds(other, null, T0 + minutes(3)), 180);
});

test('an idle bar shows zero', () => {
  assert.equal(barSeconds(null, null, T0), 0);
  assert.equal(barSeconds(null, pause({ paused: false, clone_entry_id: 2 }), T0), 0);
});

test('the draft of a paused bar is the fields Resume will start', () => {
  assert.deepEqual(pauseDraft(pause()), {
    description: 'Write the spec', project_id: 4, task_id: 9, tags: ['docs', 'web'], billable: true,
  });
});

test('the draft does not share the pause tags', () => {
  const held = pause();
  const draft = pauseDraft(held);
  draft.tags.push('later');
  assert.deepEqual(held.tags, ['docs', 'web']);
});
