import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeEntry } from '@tokkl/types';
import { followRunningEntry, type RunningDraftState } from './runningDraftSync.ts';
import { EMPTY_DRAFT } from './useEntryFields.ts';
import { timeEntry } from '../testFixtures.ts';

const START = '2026-10-27T10:00:00.000Z';

const running = (id: number, overrides: Partial<TimeEntry> = {}) =>
  timeEntry({ id, start: START, at: START, description: 'Server text', ...overrides });

const idle: RunningDraftState = {
  current: null,
  shownEntryId: null,
  ownStart: null,
  draft: EMPTY_DRAFT,
  typing: false,
};

test('nothing happens while no timer runs and none was shown', () => {
  assert.deepEqual(followRunningEntry(idle), { kind: 'idle' });
});

test('a stopped timer clears the draft', () => {
  assert.deepEqual(followRunningEntry({ ...idle, shownEntryId: 7 }), { kind: 'clear' });
});

test("this bar's own start takes what was typed since Start", () => {
  const step = followRunningEntry({
    ...idle,
    current: running(7, { description: '' }),
    ownStart: { startMs: Date.parse(START), base: EMPTY_DRAFT },
    draft: { ...EMPTY_DRAFT, description: 'Typed after Start' },
  });
  assert.equal(step.kind, 'adopt');
  assert.ok(step.kind === 'adopt');
  assert.deepEqual(step.edits, { description: 'Typed after Start' });
  assert.equal(step.draft.description, 'Typed after Start');
  assert.equal(step.entryId, 7);
});

test('another entry with a different start is mirrored and the remembered start is dropped', () => {
  const step = followRunningEntry({
    ...idle,
    current: running(8),
    ownStart: { startMs: Date.parse(START) + 1000, base: EMPTY_DRAFT },
  });
  assert.deepEqual(step, {
    kind: 'mirror',
    entryId: 8,
    draft: { description: 'Server text', project_id: null, task_id: null, tags: [], billable: false },
    keepDescription: false,
    forgetOwnStart: true,
  });
});

test('a refetch of the shown entry keeps a description being typed, but not after a switch', () => {
  const same = followRunningEntry({ ...idle, current: running(7), shownEntryId: 7, typing: true });
  assert.ok(same.kind === 'mirror' && same.keepDescription && !same.forgetOwnStart);
  const other = followRunningEntry({ ...idle, current: running(8), shownEntryId: 7, typing: true });
  assert.ok(other.kind === 'mirror' && !other.keepDescription);
});
