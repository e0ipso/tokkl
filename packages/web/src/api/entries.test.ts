import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { updateEntry } from './entries.ts';
import { settleOtherWrites } from './timerState.ts';
import type { TimeEntry } from './types.ts';

const entry = (id: number, description: string): TimeEntry => ({
  id,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T09:00:00.000Z',
  stop: null,
  duration: -1,
  description,
  tags: [],
  tag_ids: [],
  at: '2026-10-27T09:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
});

/** A fetch that holds every request until the test answers it, in any order. */
function holding() {
  const requests: Array<{ path: string; description: string; answer: () => void }> = [];
  const fetch = (path: string, init: RequestInit) => {
    const { description } = JSON.parse(String(init.body)) as { description: string };
    return new Promise<Response>(resolve => {
      requests.push({
        path,
        description,
        answer: () => resolve(new Response(JSON.stringify(entry(Number(path.split(/[/?]/)[6]), description)))),
      });
    });
  };
  return { fetch, requests };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('edits of one entry go out one at a time, in the order made; edits of another entry do not wait', async t => {
  const qc = new QueryClient();
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateEntry(qc, 1, { id: 7, description: 'Wri' });
  const second = updateEntry(qc, 1, { id: 7, description: 'Write' }, { running: true });
  const other = updateEntry(qc, 1, { id: 8, description: 'Other' });
  await tick();
  assert.deepEqual(
    requests.map(request => request.description),
    ['Wri', 'Other'],
    'the second edit of entry 7 waits for the first',
  );
  requests[1]!.answer();
  assert.equal((await other).description, 'Other');
  requests[0]!.answer();
  assert.equal((await first).description, 'Wri');
  await tick();
  assert.deepEqual(
    requests.map(request => request.description),
    ['Wri', 'Other', 'Write'],
  );
  assert.equal(requests[2]!.path, '/api/v9/workspaces/1/time_entries/7?meta=true');
  requests[2]!.answer();
  assert.equal((await second).description, 'Write');
});

test('a timer action waits for an edit queued behind another edit of the same entry, not failing as offline', async t => {
  const qc = new QueryClient();
  const { fetch, requests } = holding();
  t.mock.method(globalThis, 'fetch', fetch);
  const first = updateEntry(qc, 1, { id: 7, description: 'A' });
  const second = updateEntry(qc, 1, { id: 7, description: 'B' });
  await tick();
  const waiting = settleOtherWrites(qc);
  requests[0]!.answer();
  await first;
  await tick();
  requests[1]!.answer();
  await second;
  assert.equal(await waiting, true);
});
