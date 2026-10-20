import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Project, TimeEntry } from '../api/types.ts';
import {
  EMPTY_DRAFT, MAX_SUGGESTIONS, projectChanges, suggestedDraft, suggestionsFrom, useEntryFields, type EntryDraft,
} from './useEntryFields.ts';

let nextId = 1;

function entry(extra: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: nextId++, workspace_id: 1, project_id: null, task_id: null, billable: false, start: '2026-10-20T09:00:00Z',
    stop: '2026-10-20T10:00:00Z', duration: 3600, description: '', tags: [], tag_ids: [], at: '2026-10-20T10:00:00Z',
    server_deleted_at: null, ...extra,
  };
}

function project(id: number, billable: boolean): Project {
  return {
    id, workspace_id: 1, client_id: null, client_name: null, name: `Project ${id}`, color: '#3366cc', active: true, billable,
    estimated_hours: null, rate: null, currency: null, actual_seconds: 0, status: 'active',
  };
}

const PROJECTS = [project(1, true), project(2, false)];

test('suggestions keep one per description, project and task, newest first', () => {
  const entries = [
    entry({ description: 'Review', project_id: 1, task_id: 5 }),
    entry({ description: 'Review', project_id: 1, task_id: 5, tags: ['old'] }),
    entry({ description: 'Review', project_id: 1, task_id: 6 }),
    entry({ description: 'Review', project_id: 2 }),
    entry({ description: 'Review' }),
  ];
  const keys = suggestionsFrom(entries, '').map((s) => [s.description, s.project_id, s.task_id]);
  assert.deepEqual(keys, [['Review', 1, 5], ['Review', 1, 6], ['Review', 2, null], ['Review', null, null]]);
  assert.deepEqual(suggestionsFrom(entries, '')[0]!.tags, [], 'the newest entry of a kind wins');
});

test('suggestions leave out entries with neither a description nor a project', () => {
  const entries = [entry({ tags: ['loose'] }), entry({ project_id: 2 }), entry({ description: 'Plan' })];
  assert.deepEqual(suggestionsFrom(entries, '').map((s) => s.key), ['\u00002\u0000', 'Plan\u0000\u0000']);
});

test('suggestions match the query in the description, project or client, ignoring case and outer spaces', () => {
  const entries = [
    entry({ description: 'Write the spec' }),
    entry({ description: 'Standup', project_id: 1, project_name: 'Spectrum' }),
    entry({ description: 'Invoice', project_id: 2, project_name: 'Billing', client_name: 'Inspect Ltd' }),
    entry({ description: 'Lunch' }),
  ];
  assert.deepEqual(suggestionsFrom(entries, '  SPEC ').map((s) => s.description), ['Write the spec', 'Standup', 'Invoice']);
  assert.deepEqual(suggestionsFrom(entries, 'nothing').map((s) => s.description), []);
});

test('suggestions stop at eight', () => {
  const entries = Array.from({ length: 12 }, (_, i) => entry({ description: `Task ${i}` }));
  const suggestions = suggestionsFrom(entries, '');
  assert.equal(MAX_SUGGESTIONS, 8);
  assert.deepEqual(suggestions.map((s) => s.description), entries.slice(0, 8).map((e) => e.description));
});

test('a picked suggestion fills every draft field and nothing else', () => {
  const [suggestion] = suggestionsFrom([entry({
    description: 'Review', project_id: 1, task_id: 5, tags: ['web'], billable: true, project_name: 'Site', project_color: '#ff0000',
  })], '');
  assert.deepEqual(suggestedDraft(suggestion!), { description: 'Review', project_id: 1, task_id: 5, tags: ['web'], billable: true });
});

test('picking a billable project turns billable on', () => {
  assert.deepEqual(projectChanges(EMPTY_DRAFT, PROJECTS, 1, 7), { project_id: 1, task_id: 7, billable: true });
});

test('picking a non-billable project, no project or an unknown one leaves billable as it was', () => {
  const billable: EntryDraft = { ...EMPTY_DRAFT, project_id: 1, billable: true };
  for (const id of [2, null, 99]) {
    assert.equal(projectChanges(EMPTY_DRAFT, PROJECTS, id, null).billable, false, `project ${id}, billable off`);
    assert.equal(projectChanges(billable, PROJECTS, id, null).billable, true, `project ${id}, billable on`);
  }
});

/** Renders the hook once for `draft` and returns what it gave back. */
function renderHook(draft: EntryDraft, recentEntries: TimeEntry[] = []) {
  let result: ReturnType<typeof useEntryFields> | undefined;
  function Probe() {
    result = useEntryFields({ draft, recentEntries, projects: PROJECTS });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(result);
  return result;
}

test('the hook edits a draft with no running entry: it finds the project and applies the billable rule to the draft', () => {
  const draft: EntryDraft = { description: 'Draft only', project_id: 2, task_id: null, tags: ['web'], billable: false };
  const fields = renderHook(draft, [entry({ description: 'Draft only' })]);
  assert.equal(fields.project?.id, 2);
  assert.equal(fields.highlight, -1);
  assert.deepEqual(fields.suggestions, [], 'suggestions wait until the description asks for them');
  assert.deepEqual(fields.projectChanges(1, null), { project_id: 1, task_id: null, billable: true });
  assert.deepEqual(fields.projectChanges(2, 3), { project_id: 2, task_id: 3, billable: false });
  assert.equal(renderHook(EMPTY_DRAFT).project, undefined);
});
