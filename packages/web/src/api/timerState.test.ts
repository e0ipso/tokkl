import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import type { TimeEntry, TimerPause, TimerPomodoro, TimerState } from './types.ts';
import {
  MOVES_TIMER,
  TIMER_CONFLICT_MESSAGE,
  TIMER_OFFLINE_MESSAGE,
  TimerActionError,
  explainTimerActionError,
  isTimerState,
  planTimerUpdate,
  revisionToSend,
  settleOtherWrites,
  timerStateOf,
} from './timerState.ts';
import { t } from '../i18n/messages.ts';
import { ApiError, RequestTimeoutError } from './client.ts';
import { clockOffset, serverNow } from './serverClock.ts';

const entry: TimeEntry = {
  id: 7,
  workspace_id: 1,
  project_id: null,
  task_id: null,
  billable: false,
  start: '2026-10-27T10:00:00.000Z',
  stop: null,
  duration: -1,
  description: 'Write',
  tags: [],
  tag_ids: [],
  at: '2026-10-27T10:00:00.000Z',
  server_deleted_at: null,
  all_day: false,
};

function state(revision: number, overrides: Partial<TimerState> = {}): TimerState {
  return {
    revision,
    server_time: '2026-10-27T10:00:05.000Z',
    running_entry: entry,
    pause: null,
    pomodoro: null,
    discarded_pomodoro: null,
    ...overrides,
  };
}

test('a state with a lower revision than the cached one is dropped; an equal or higher one is kept', () => {
  assert.equal(planTimerUpdate(state(5), state(4), 0), null);
  assert.equal(planTimerUpdate(state(5), state(5), 0)?.changed, false);
  assert.equal(planTimerUpdate(state(5), state(6), 0)?.changed, true);
  // Nothing cached yet: any state is the first, and it is not a change to refresh lists for.
  assert.equal(planTimerUpdate(undefined, state(1), 0)?.changed, false);
});

test('the running entry comes with the state, and no running entry clears it', () => {
  assert.equal(planTimerUpdate(undefined, state(1), 0)?.state.running_entry, entry);
  assert.equal(planTimerUpdate(state(1), state(2, { running_entry: null }), 0)?.state.running_entry, null);
});

test('the clock offset is the server time minus the local time at arrival', () => {
  const server = Date.parse('2026-10-27T10:00:05.000Z');
  assert.equal(clockOffset('2026-10-27T10:00:05.000Z', server - 3000), 3000);
  assert.equal(clockOffset('2026-10-27T10:00:05.000Z', server + 2000), -2000);
  assert.equal(clockOffset('not a date', 0), null);
  assert.equal(serverNow(1_000_000, 3000).getTime(), 1_003_000);
  assert.equal(planTimerUpdate(undefined, state(1), server - 3000)?.offset, 3000);
});

const pause: TimerPause = {
  paused: true,
  seconds: 600,
  workspace_id: 1,
  description: 'Write',
  project_id: null,
  task_id: null,
  tag_ids: [3],
  tags: ['deep'],
  billable: false,
  clone_entry_id: null,
};

const pomodoro: TimerPomodoro = {
  work_minutes: 25,
  short_rest_minutes: 5,
  long_rest_minutes: 15,
  long_rest_every: 4,
  phase: {
    kind: 'work',
    start: '2026-10-27T10:00:00.000Z',
    completed: 0,
    planned_end: '2026-10-27T10:25:00.000Z',
  },
  upcoming_phase: 'shortRest',
  transition: 'workToShortRest',
  number: 1,
  entry_id: 7,
  pomodoro_start: '2026-10-27T10:00:00.000Z',
};

test('only objects shaped like a timer state pass the guard', () => {
  assert.equal(isTimerState(state(1)), true);
  assert.equal(isTimerState(state(1, { running_entry: null, pause })), true);
  assert.equal(isTimerState(state(1, { pomodoro })), true);
  assert.equal(
    isTimerState(
      state(1, {
        running_entry: null,
        discarded_pomodoro: { entry_id: 7, start: '2026-10-27T09:00:00.000Z', stop: '2026-10-27T09:00:00.000Z' },
      }),
    ),
    true,
  );
  assert.equal(isTimerState(null), false);
  assert.equal(isTimerState('x'), false);
  assert.equal(isTimerState({ revision: '1', server_time: 'x' }), false);
  assert.equal(isTimerState({ error: 'Conflict' }), false);
});

test('a state whose nested parts are malformed or missing fails the guard', () => {
  // The revision and server time alone are not a state.
  assert.equal(isTimerState({ revision: 1, server_time: '2026-10-27T10:00:05.000Z' }), false);
  assert.equal(isTimerState(state(1, { running_entry: { ...entry, start: 5 } as unknown as TimeEntry })), false);
  assert.equal(isTimerState(state(1, { pause: { ...pause, paused: 'yes' } as unknown as TimerPause })), false);
  assert.equal(
    isTimerState(
      state(1, { pomodoro: { ...pomodoro, phase: { ...pomodoro.phase, kind: 'nap' } } as unknown as TimerPomodoro }),
    ),
    false,
  );
  assert.equal(
    isTimerState(state(1, { pomodoro: { ...pomodoro, transition: undefined } as unknown as TimerPomodoro })),
    false,
  );
  assert.equal(
    isTimerState(state(1, { discarded_pomodoro: { entry_id: 7 } as unknown as TimerState['discarded_pomodoro'] })),
    false,
  );
});

test('a state needs a whole revision and real instants', () => {
  assert.equal(isTimerState(state(1.5)), false);
  assert.equal(isTimerState(state(1, { server_time: '2026-10-27T10:00:05' })), false);
  assert.equal(isTimerState(state(1, { server_time: 'yesterday' })), false);
  assert.equal(
    isTimerState(state(1, { discarded_pomodoro: { entry_id: 7, start: '2026-10-27T10:00:00Z', stop: 'soon' } })),
    false,
  );
});

test('a malformed timer state fails its request with the unreadable-state message', () => {
  assert.equal(timerStateOf(state(3)).revision, 3);
  assert.throws(() => timerStateOf({ ...state(3), pause: { paused: true } }), { message: t('timer.unreadableState') });
});

test('a 409 whose body is not a whole state stays a plain ApiError', () => {
  const body = { ...state(9), pomodoro: { phase: null } };
  const error = new ApiError(409, JSON.stringify(body), body);
  assert.equal(explainTimerActionError(error), error);
});

test('a 409 carrying a state explains itself and hands the state over; other failures pass through', () => {
  const current = state(9);
  const conflict = explainTimerActionError(new ApiError(409, JSON.stringify(current), current));
  assert.ok(conflict instanceof TimerActionError);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.message, TIMER_CONFLICT_MESSAGE);
  assert.equal(conflict.state, current);

  const offline = explainTimerActionError(new TypeError('Failed to fetch'));
  assert.ok(offline instanceof TimerActionError);
  assert.equal(offline.kind, 'offline');
  assert.equal(offline.message, TIMER_OFFLINE_MESSAGE);

  // A write with no reply by its deadline may have reached the server, as one that got no reply at all.
  const late = explainTimerActionError(new RequestTimeoutError('POST', '/api/app/timer/resume'));
  assert.ok(late instanceof TimerActionError);
  assert.equal(late.kind, 'offline');

  const other = new ApiError(409, 'Conflict', 'Conflict');
  assert.equal(explainTimerActionError(other), other);
  const bad = new ApiError(400, 'Invalid revision', 'Invalid revision');
  assert.equal(explainTimerActionError(bad), bad);
  const unknown = new RangeError('x');
  assert.equal(explainTimerActionError(unknown), unknown);
});

/**
 * Starts a mutation in `qc` that stays pending until the returned function is called. It is marked
 * as moving the timer revision unless `meta` says otherwise.
 */
function pendingWrite(qc: QueryClient, meta: { movesTimer?: boolean } = MOVES_TIMER): () => void {
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  void qc
    .getMutationCache()
    .build(qc, { meta, mutationFn: () => held })
    .execute(undefined);
  return release;
}

test('with no write in flight there is nothing to wait for', async () => {
  const qc = new QueryClient();
  assert.equal(await settleOtherWrites(qc), false);
});

test('a write in flight, such as an edit of the running entry, is waited for, because it moves the revision', async () => {
  const qc = new QueryClient();
  const release = pendingWrite(qc);
  let settled = false;
  const waiting = settleOtherWrites(qc).then(waited => {
    settled = true;
    return waited;
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false, 'still waiting while the edit is pending');
  release();
  assert.equal(await waiting, true);
});

test('a write that cannot move the revision is not waited for, nor is another timer action', async () => {
  const qc = new QueryClient();
  // A preference or profile save, and a timer action, carry no MOVES_TIMER meta.
  const releaseSave = pendingWrite(qc, {});
  const releaseAction = pendingWrite(qc, {});
  try {
    assert.equal(await settleOtherWrites(qc), false);
  } finally {
    releaseSave();
    releaseAction();
  }
});

test('an unrelated write held for the connection does not fail the action', async t => {
  const qc = new QueryClient();
  onlineManager.setOnline(false);
  t.after(() => onlineManager.setOnline(true));
  const release = pendingWrite(qc, {});
  try {
    assert.equal(qc.getMutationCache().getAll()[0]?.state.isPaused, true, 'the save waits for the connection');
    assert.equal(await settleOtherWrites(qc), false);
  } finally {
    release();
  }
});

test('only the marked write is waited for while an unrelated one stays pending', async () => {
  const qc = new QueryClient();
  const releaseSave = pendingWrite(qc, {});
  const releaseEdit = pendingWrite(qc);
  try {
    const waiting = settleOtherWrites(qc);
    releaseEdit();
    assert.equal(await waiting, true);
  } finally {
    releaseSave();
  }
});

test('a write held for the connection fails the action as offline instead of sending it after reconnect', async t => {
  const qc = new QueryClient();
  onlineManager.setOnline(false);
  t.after(() => onlineManager.setOnline(true));
  const release = pendingWrite(qc);
  try {
    await assert.rejects(
      settleOtherWrites(qc),
      (error: unknown) =>
        error instanceof TimerActionError && error.kind === 'offline' && error.message === TIMER_OFFLINE_MESSAGE,
    );
  } finally {
    release();
  }
});

test('a write that the connection holds while the action waits for it fails the action as offline', async t => {
  const qc = new QueryClient();
  t.after(() => onlineManager.setOnline(true));
  // The edit fails once and is held for its retry while the browser is offline.
  let calls = 0;
  void qc
    .getMutationCache()
    .build(qc, {
      meta: MOVES_TIMER,
      retry: 1,
      retryDelay: 0,
      mutationFn: () => {
        calls += 1;
        if (calls === 1) {
          onlineManager.setOnline(false);
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve();
      },
    })
    .execute(undefined);
  await assert.rejects(
    settleOtherWrites(qc),
    (error: unknown) => error instanceof TimerActionError && error.kind === 'offline',
  );
});

const phase = (start: string) => ({
  work_minutes: 25,
  short_rest_minutes: 5,
  long_rest_minutes: 15,
  long_rest_every: 4,
  phase: { kind: 'work' as const, start, completed: 0, planned_end: '2026-10-27T10:25:00.000Z' },
  upcoming_phase: 'shortRest' as const,
  transition: 'workToShortRest' as const,
  number: 1,
  entry_id: 7,
  pomodoro_start: start,
});

test("after this tab's own edit, an action confirms the phase the user saw at the edit's new revision", () => {
  const seen = state(4, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  const edited = state(5, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  assert.equal(revisionToSend(seen, edited), 5);
});

test('when the phase or pause changed meanwhile, the action keeps the revision the user saw, so the server refuses it', () => {
  const seen = state(4, { pomodoro: phase('2026-10-27T10:00:00.000Z') });
  assert.equal(revisionToSend(seen, state(6, { pomodoro: phase('2026-10-27T10:26:00.000Z') })), 4);
  assert.equal(revisionToSend(seen, state(6)), 4, 'the session ended');
  const pause = {
    paused: true,
    seconds: 60,
    workspace_id: 1,
    description: '',
    project_id: null,
    task_id: null,
    tag_ids: [],
    tags: [],
    billable: false,
    clone_entry_id: null,
  };
  const paused = state(4, { running_entry: null, pause });
  assert.equal(revisionToSend(paused, state(5, { running_entry: null, pause })), 5);
  assert.equal(
    revisionToSend(paused, state(5, { pause: { ...pause, paused: false, clone_entry_id: 8 } })),
    4,
    'resumed elsewhere',
  );
  assert.equal(revisionToSend(paused, state(5, { running_entry: null })), 4, 'discarded elsewhere');
});
