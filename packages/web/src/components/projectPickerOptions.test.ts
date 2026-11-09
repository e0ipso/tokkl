import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project, Task } from '@tokkl/types';
import { groupPickerProjects, pickerOptions } from './projectPickerOptions.ts';

function project(id: number, name: string, client: string | null, active = true): Project {
  return {
    id,
    workspace_id: 1,
    client_id: client ? id * 10 : null,
    client_name: client,
    name,
    color: '#000000',
    active,
    billable: false,
    estimated_hours: null,
    rate: null,
    currency: null,
    actual_seconds: 0,
    status: active ? 'active' : 'archived',
  };
}

function task(id: number, projectId: number, name: string, active = true): Task {
  return { id, project_id: projectId, name, active, estimated_seconds: null, tracked_seconds: 0 };
}

const projects = [
  project(1, 'Website', 'Zeta'),
  project(2, 'Internal', null),
  project(3, 'App', 'Acme'),
  project(4, 'Old', null, false),
];
const tasks = [task(10, 1, 'Design'), task(11, 1, 'Copy'), task(12, 3, 'Release'), task(13, 3, 'Gone', false)];

test('an empty search lists active projects by client, unassigned first, with their active tasks', () => {
  const groups = groupPickerProjects(projects, tasks, '');
  assert.deepEqual(
    groups.map(group => [group.client, group.rows.map(row => [row.project.id, row.tasks.map(t => t.id)])]),
    [
      ['', [[2, []]]],
      ['Acme', [[3, [12]]]],
      ['Zeta', [[1, [10, 11]]]],
    ],
  );
});

test('a project matching by name or client keeps all its tasks', () => {
  const byClient = groupPickerProjects(projects, tasks, 'zet');
  assert.deepEqual(
    byClient.map(group => group.rows.map(row => row.tasks.length)),
    [[2]],
  );
});

test('a task match shows its project with only the matching tasks', () => {
  const groups = groupPickerProjects(projects, tasks, 'des');
  assert.deepEqual(
    groups.map(group => group.rows.map(row => [row.project.id, row.tasks.map(t => t.id)])),
    [[[1, [10]]]],
  );
  assert.deepEqual(groupPickerProjects(projects, tasks, 'gone'), []);
});

test('options follow display order, with No project only for an empty search', () => {
  assert.deepEqual(pickerOptions(groupPickerProjects(projects, tasks, ''), '').slice(0, 3), [
    { projectId: null, taskId: null },
    { projectId: 2, taskId: null },
    { projectId: 3, taskId: null },
  ]);
  assert.deepEqual(pickerOptions(groupPickerProjects(projects, tasks, 'des'), 'des'), [
    { projectId: 1, taskId: null },
    { projectId: 1, taskId: 10 },
  ]);
});
