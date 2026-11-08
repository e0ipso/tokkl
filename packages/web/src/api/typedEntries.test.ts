import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, UnparsableReplyError } from './client.ts';
import { keys } from './keys.ts';
import { TimerActionError, isTimerUnknown } from './timerState.ts';
import { addTypedEntry, landedTypedEntry, type TypedEntryInput, type TypedEntryRequests } from './typedEntries.ts';
import type { TimeEntry, TimerState } from './types.ts';

const settings = { timeZone: 'Europe/Madrid', timeResolution: 15 };

/** Stored as the server snaps it at 15 minutes: 10:00 to 10:30 UTC. */
const sent: TypedEntryInput = {
  description: 'Review',
  project_id: 4,
  tags: [],
  billable: false,
  start: '2026-10-27T10:00:07.000Z',
  stop: '2026-10-27T10:29:55.000Z',
};
const span = { start: new Date('2026-10-27T10:00:00.000Z'), stop: new Date('2026-10-27T10:30:00.000Z') };
const match = { description: 'Review', project_id: 4, span };

const stored = (id: number, fields: Partial<TimeEntry> = {}): TimeEntry => ({
  id,
  workspace_id: 1,
  project_id: 4,
  task_id: null,
  billable: false,
  start: '2026-10-27T10:00:00Z',
  stop: '2026-10-27T10:30:00Z',
  duration: 1800,
  description: 'Review',
  tags: [],
  tag_ids: [],
  at: '2026-10-27T10:30:00Z',
  server_deleted_at: null,
  all_day: false,
  ...fields,
});

test('a new entry with the stored span, description and project is the one the lost create stored', () => {
  assert.equal(landedTypedEntry([stored(1, { description: 'Other' })], [stored(1), stored(2)], match)?.id, 2);
});

test('an identical entry that was already there is not taken for the lost create', () => {
  assert.equal(landedTypedEntry([stored(1)], [stored(1)], match), null);
});

test('a new entry that differs in span, description or project is not the lost create', () => {
  const after = [
    stored(2, { stop: '2026-10-27T10:45:00Z' }),
    stored(3, { start: '2026-10-27T09:45:00Z' }),
    stored(4, { description: 'Revie' }),
    stored(5, { project_id: null }),
    stored(6, { stop: null }),
  ];
  assert.equal(landedTypedEntry([], after, match), null);
});

/** Requests that answer the day reads in turn and the create with `create`, recording each call. */
function requestsOf(days: TimeEntry[][], create: () => Promise<TimeEntry>) {
  const calls: string[] = [];
  const requests: TypedEntryRequests = {
    create: () => {
      calls.push('create');
      return create();
    },
    day: day => {
      calls.push(`day ${day}`);
      const reply = days.shift();
      return reply ? Promise.resolve(reply) : Promise.reject(new TypeError('Failed to fetch'));
    },
  };
  return { requests, calls };
}

function seeded(): QueryClient {
  const qc = new QueryClient();
  const state: TimerState = {
    revision: 1,
    server_time: '2026-10-27T10:30:00.000Z',
    running_entry: null,
    pause: null,
    pomodoro: null,
    discarded_pomodoro: null,
  };
  qc.setQueryData(keys.timer, state);
  return qc;
}

test('a create whose reply was lost and that landed is answered with the stored entry, not sent again', async () => {
  const qc = seeded();
  const { requests, calls } = requestsOf([[stored(1, { description: 'Earlier' })], [stored(1), stored(2)]], () =>
    Promise.reject(new ApiError(502, 'Bad Gateway')),
  );
  const entry = await addTypedEntry(qc, requests, sent, settings);
  assert.equal(entry.id, 2);
  assert.deepEqual(calls, ['day 2026-10-27', 'create', 'day 2026-10-27']);
  assert.equal(isTimerUnknown(qc), false, 'the outcome is known: the create landed');
});

test('a lost create that did not land fails with its own error and leaves the outcome unknown', async () => {
  const qc = seeded();
  const lost = new UnparsableReplyError(
    'POST',
    '/api/v9/workspaces/1/time_entries',
    new SyntaxError('Unexpected token <'),
  );
  const { requests, calls } = requestsOf([[stored(1)], [stored(1)]], () => Promise.reject(lost));
  await assert.rejects(addTypedEntry(qc, requests, sent, settings), (error: unknown) => error === lost);
  assert.deepEqual(calls, ['day 2026-10-27', 'create', 'day 2026-10-27']);
  assert.equal(isTimerUnknown(qc), true);
});

test('a read after a lost create that fails keeps the create error', async () => {
  const qc = seeded();
  const { requests } = requestsOf([[]], () => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(
    addTypedEntry(qc, requests, sent, settings),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'offline',
  );
});

test('a refused create is not looked up', async () => {
  const qc = seeded();
  const refused = new ApiError(400, 'Invalid project');
  const { requests, calls } = requestsOf([[]], () => Promise.reject(refused));
  await assert.rejects(addTypedEntry(qc, requests, sent, settings), (error: unknown) => error === refused);
  assert.deepEqual(calls, ['day 2026-10-27', 'create']);
});

test('a first read that gets no reply fails with the offline message and sends nothing', async () => {
  const qc = seeded();
  const { requests, calls } = requestsOf([], () => Promise.resolve(stored(2)));
  await assert.rejects(
    addTypedEntry(qc, requests, sent, settings),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'offline',
  );
  assert.deepEqual(calls, ['day 2026-10-27']);
});

test('a span too short to store goes straight to the server, which refuses it', async () => {
  const qc = seeded();
  const { requests, calls } = requestsOf([], () => Promise.reject(new ApiError(400, 'Too short')));
  const short = { ...sent, stop: '2026-10-27T10:03:00.000Z' };
  await assert.rejects(addTypedEntry(qc, requests, short, settings), (error: unknown) => error instanceof ApiError);
  assert.deepEqual(calls, ['create']);
});
