import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerSnapshot } from '../src/storage/domain.ts';
import {
  decodeTimerFingerprint,
  encodeTimerFingerprint,
  IDLE_TIMER_FINGERPRINT,
} from '../src/domain/timerFingerprint.ts';

/** A running pomodoro with a project, a client, a task and tags out of id order. */
const snapshot = {
  running: {
    id: 7,
    workspaceId: 1,
    projectId: 3,
    taskId: 4,
    description: 'Focus',
    start: '2026-10-14T09:00:00.000Z',
    billable: true,
    tags: [
      { id: 9, name: 'b' },
      { id: 2, name: 'a' },
    ],
    project: { name: 'Site', color: '#06a893', active: true, billable: true },
    client: { id: 5, name: 'Acme' },
    task: { name: 'Copy', active: true },
  },
  pauseChain: null,
  session: {
    userId: 1,
    entryId: 7,
    config: { workMinutes: 25, shortRestMinutes: 5, longRestMinutes: 15, longRestEvery: 4 },
    phase: { kind: 'work', startedAt: '2026-10-14T09:00:00.000Z', completed: 0 },
  },
  revision: null,
} as unknown as TimerSnapshot;

test('the encoding stays byte for byte what earlier servers stored', () => {
  assert.equal(IDLE_TIMER_FINGERPRINT, '{"running":null,"session":null,"chain":null}');
  assert.equal(
    encodeTimerFingerprint(snapshot, []),
    '{"running":{"id":7,"workspaceId":1,"projectId":3,"taskId":4,"description":"Focus",' +
      '"start":"2026-10-14T09:00:00.000Z","billable":true,"tags":[{"id":2,"name":"a"},{"id":9,"name":"b"}],' +
      '"project":{"name":"Site","color":"#06a893","active":true,"billable":true},"client":{"id":5,"name":"Acme"},' +
      '"task":{"name":"Copy","active":true}},"session":{"userId":1,"entryId":7,' +
      '"config":{"workMinutes":25,"shortRestMinutes":5,"longRestMinutes":15,"longRestEvery":4},' +
      '"phase":{"kind":"work","startedAt":"2026-10-14T09:00:00.000Z","completed":0}},"chain":null}',
  );
});

test('decoding reads the session entry back, and anything else as no session', () => {
  assert.deepEqual(decodeTimerFingerprint(encodeTimerFingerprint(snapshot, [])), { sessionEntryId: 7 });
  assert.deepEqual(decodeTimerFingerprint(IDLE_TIMER_FINGERPRINT), { sessionEntryId: null });
  for (const text of ['', 'not json', 'null', '[]', '{"session":{"entryId":"7"}}', '{"session":{"entryId":1.5}}'])
    assert.deepEqual(decodeTimerFingerprint(text), { sessionEntryId: null }, text);
});
