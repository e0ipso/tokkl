import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@tokkl/types';
import { archiveNotice, deleteNotice, projectCountsByClient, visibleClients } from './clientList.ts';
import { project as testProject } from '../../testFixtures.ts';

const client = (id: number, name: string, archived = false, notes: string | null = null): Client => ({
  id,
  wid: 1,
  name,
  notes,
  archived,
});

const project = (id: number, clientId: number | null) =>
  testProject({ id, client_id: clientId, name: `P${id}`, active: id % 2 === 0 });

test('project counts include archived projects and skip those without a client', () => {
  const counts = projectCountsByClient([project(1, 5), project(2, 5), project(3, null), project(4, 6)]);
  assert.deepEqual(
    [...counts],
    [
      [5, 2],
      [6, 1],
    ],
  );
});

test('the list filters by status and searches names and notes', () => {
  const clients = [client(1, 'Acme'), client(2, 'Globex', true, 'big acme deal'), client(3, 'Initech')];
  assert.deepEqual(
    visibleClients(clients, 'active', '').map(c => c.id),
    [1, 3],
  );
  assert.deepEqual(
    visibleClients(clients, 'all', 'ACME').map(c => c.id),
    [1, 2],
  );
  assert.deepEqual(
    visibleClients(clients, 'archived', '').map(c => c.id),
    [2],
  );
});

test('the dialogs say what happens to the projects', () => {
  assert.equal(archiveNotice(0), 'It has no projects right now.');
  assert.match(archiveNotice(2), /^This also archives its 2 projects\./);
  assert.equal(deleteNotice(0, 'Acme'), "It has no projects. Time entries don't change. You can't undo this.");
  assert.equal(
    deleteNotice(1, 'Acme'),
    'Its project stays, without a client. If a project without a client already has the same name, "(Acme)" is added to the moved one. Time entries don\'t change. You can\'t undo this.',
  );
  assert.match(deleteNotice(3, 'Acme'), /^Its 3 projects stay, without a client\./);
});
