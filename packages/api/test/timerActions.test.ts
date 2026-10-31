import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerState } from '@tokkl/types';
import { ConflictWithBody, HttpError } from '../src/lib/errors.ts';
import { listDeletedEntries, listTimeEntries, serializeTimeEntry } from './fixtures/domain.ts';
import { getUser } from './fixtures/domain.ts';
import { addWorkspaceMember } from './fixtures/domain.ts';
import { subscribeTimer } from './fixtures/domain.ts';
import {
  discardPause, endPomodoro, getTimerState, nextPomodoroPhase, pauseTimer, resumeTimer, startPomodoro,
} from './fixtures/domain.ts';
import { addUser, setup, type TestContext } from './helpers.ts';

/** An instant on the day these tests track time on. */
const at = (time: string) => new Date(`2026-10-14T${time}Z`);
const iso = (time: string) => at(time).toISOString();
/** The same instant as the v9 API writes it. */
const v9 = (time: string) => `2026-10-14T${time}+00:00`;

interface SessionContext extends TestContext {
  /** Publishes the hub made for the user since the last call. */
  published: () => number;
}

/**
 * A user on an instance with a 1-minute resolution, whose Pomodoro preferences are 1-minute work
 * phases and rests with a long rest after every 2 work phases. `user` is read after the
 * preferences were saved, as a request would read it.
 */
async function sessionSetup(): Promise<SessionContext> {
  const ctx = (await setup());
  assert.equal((await ctx.json('PUT', '/api/app/admin/settings', { time_resolution_minutes: 1 })).status, 200);
  const saved = await ctx.json('POST', '/api/v9/me/preferences', {
    pomodoro_focus_interval_in_minutes: 1, pomodoro_break_interval_in_minutes: 1,
    pomodoro_long_break_interval_in_minutes: 1, pomodoro_long_break_every: 2,
  });
  assert.equal(saved.status, 200);
  let count = 0;
  subscribeTimer(ctx.db, ctx.user.id, () => count++);
  const published = () => {
    const seen = count;
    count = 0;
    return seen;
  };
  return { ...ctx, user: (await getUser(ctx.db, ctx.user.id))!, published };
}

/** The user's entries outside the trash, oldest first, with the fields a pomodoro carries over. */
async function stored(ctx: TestContext) {
  return (await listTimeEntries(ctx.db, ctx.user.id)).reverse().map((row) => {
    const { id, start, stop, description, project_id, tags, billable } = serializeTimeEntry(row);
    return { id, start, stop, description, project_id, tags, billable, created_with: row.createdWith };
  });
}

/** The ids of the user's entries in the trash, with their start and stop as the v9 API writes them. */
async function trashed(ctx: TestContext) {
  return (await listDeletedEntries(ctx.db, ctx.user.id)).map((row) => {
    const { id, start, stop } = serializeTimeEntry(row);
    return [id, start, stop];
  });
}

/** Asserts that the change from `before` to `after` raised the revision by one and published once. */
function assertOneChange(ctx: SessionContext, before: TimerState, after: TimerState, label: string): void {
  assert.equal(after.revision, before.revision + 1, label);
  assert.equal(ctx.published(), 1, label);
}

test('a session cycle stores each pomodoro on rest to work and starts the next at the confirm instant', async () => {
  const ctx = (await sessionSetup());
  const project = (await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/projects`, { name: 'Alpha' })).body.id as number;
  const idle = (await getTimerState(ctx.db, ctx.user, at('08:59:00')));
  assert.deepEqual(idle, {
    revision: 0, server_time: iso('08:59:00'), running_entry: null, pause: null, pomodoro: null, discarded_pomodoro: null,
  });

  let state = (await startPomodoro(ctx.db, ctx.user, {
    description: 'Draft', project_id: project, tags: ['deep'], billable: true, created_with: 'test-client',
  }, at('09:00:00')));
  assertOneChange(ctx, idle, state, 'start');
  const first = state.running_entry!.id;
  assert.equal(state.server_time, iso('09:00:00'));
  assert.equal(state.running_entry!.project_name, 'Alpha', 'the running entry carries meta');
  assert.deepEqual(state.pomodoro, {
    work_minutes: 1, short_rest_minutes: 1, long_rest_minutes: 1, long_rest_every: 2,
    phase: { kind: 'work', start: iso('09:00:00'), completed: 0, planned_end: iso('09:01:00') },
    upcoming_phase: 'shortRest', transition: 'workToShortRest', number: 1, entry_id: first, pomodoro_start: iso('09:00:00'),
  });
  const draft = { description: 'Draft', project_id: project, tags: ['deep'], billable: true, created_with: 'test-client' };
  assert.deepEqual((await stored(ctx)), [{ id: first, start: v9('09:00:00'), stop: null, ...draft }]);

  // Work to short rest, confirmed in overtime, changes the session only.
  let before = state;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('09:01:10')));
  assertOneChange(ctx, before, state, 'work to short rest');
  assert.deepEqual(state.pomodoro, {
    ...before.pomodoro!,
    phase: { kind: 'shortRest', start: iso('09:01:10'), completed: 1, planned_end: iso('09:02:10') },
    upcoming_phase: 'work', transition: 'shortRestToWork', number: 1,
  });
  assert.deepEqual((await stored(ctx)), [{ id: first, start: v9('09:00:00'), stop: null, ...draft }]);

  // An edit through v9 to the open pomodoro changes the state and carries into the next pomodoro.
  before = state;
  const edit = { description: 'Final', tags: ['deep', 'review'], billable: false };
  assert.equal((await ctx.json('PUT', `/api/v9/workspaces/${ctx.wid}/time_entries/${first}`, edit)).status, 200);
  state = (await getTimerState(ctx.db, ctx.user, at('09:02:00')));
  assertOneChange(ctx, before, state, 'v9 edit');
  assert.deepEqual(state.pomodoro, before.pomodoro);

  // Short rest to work stores the pomodoro snapped and starts the next at the exact confirm instant.
  before = state;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('09:02:20')));
  assertOneChange(ctx, before, state, 'short rest to work');
  const second = state.running_entry!.id;
  assert.notEqual(second, first);
  assert.deepEqual(state.pomodoro, {
    ...before.pomodoro!,
    phase: { kind: 'work', start: iso('09:02:20'), completed: 1, planned_end: iso('09:03:20') },
    upcoming_phase: 'longRest', transition: 'workToLongRest', number: 2, entry_id: second, pomodoro_start: iso('09:02:20'),
  });
  assert.equal(state.discarded_pomodoro, null);
  const final = { ...draft, ...edit };
  assert.deepEqual((await stored(ctx)), [
    { id: first, start: v9('09:00:00'), stop: v9('09:02:00'), ...final },
    { id: second, start: v9('09:02:20'), stop: null, ...final },
  ]);

  // Work to long rest, skipped before the planned end, still counts toward the long rest.
  before = state;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('09:02:50')));
  assertOneChange(ctx, before, state, 'skipped work to long rest');
  assert.deepEqual(state.pomodoro, {
    ...before.pomodoro!,
    phase: { kind: 'longRest', start: iso('09:02:50'), completed: 2, planned_end: iso('09:03:50') },
    upcoming_phase: 'work', transition: 'longRestToWork', number: 2,
  });

  // The long rest resets the count, and its pomodoro meets the first one on the grid.
  before = state;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('09:04:00')));
  assertOneChange(ctx, before, state, 'long rest to work');
  const third = state.running_entry!.id;
  assert.deepEqual(state.pomodoro, {
    ...before.pomodoro!,
    phase: { kind: 'work', start: iso('09:04:00'), completed: 0, planned_end: iso('09:05:00') },
    upcoming_phase: 'shortRest', transition: 'workToShortRest', number: 1, entry_id: third, pomodoro_start: iso('09:04:00'),
  });
  assert.deepEqual((await stored(ctx)).map(({ id, start, stop }) => [id, start, stop]), [
    [first, v9('09:00:00'), v9('09:02:00')],
    [second, v9('09:02:00'), v9('09:04:00')],
    [third, v9('09:04:00'), null],
  ]);
});

test('End session stores the open pomodoro, and one too short to keep goes to the trash on rest to work and on End', async () => {
  const ctx = (await sessionSetup());

  // End during a rest stores the work phase and the rest as one pomodoro.
  let state = (await startPomodoro(ctx.db, ctx.user, { description: 'Write' }, at('10:00:00')));
  const written = state.running_entry!.id;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('10:01:00')));
  ctx.published();
  let before = state;
  state = (await endPomodoro(ctx.db, ctx.user, state.revision, at('10:01:40')));
  assertOneChange(ctx, before, state, 'End during a rest');
  assert.deepEqual(
    { running_entry: state.running_entry, pomodoro: state.pomodoro, discarded_pomodoro: state.discarded_pomodoro },
    { running_entry: null, pomodoro: null, discarded_pomodoro: null },
  );
  assert.deepEqual((await stored(ctx)).map(({ id, start, stop }) => [id, start, stop]), [[written, v9('10:00:00'), v9('10:02:00')]]);

  // Skipping through a pomodoro in seconds leaves nothing to keep. Rest to work sends it to the
  // trash, names it in the state, and the session goes on with the next pomodoro.
  state = (await startPomodoro(ctx.db, ctx.user, { description: 'Skim' }, at('11:00:00')));
  const skimmed = state.running_entry!.id;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('11:00:05')));
  ctx.published();
  before = state;
  state = (await nextPomodoroPhase(ctx.db, ctx.user, state.revision, at('11:00:10')));
  assertOneChange(ctx, before, state, 'rest to work on a pomodoro too short to keep');
  assert.deepEqual(state.discarded_pomodoro, { entry_id: skimmed, start: iso('11:00:00'), stop: iso('11:00:00') });
  const next = state.running_entry!;
  assert.equal(next.start, v9('11:00:10'));
  assert.equal(next.description, 'Skim');
  assert.equal(state.pomodoro?.entry_id, next.id);
  assert.equal(state.pomodoro?.number, 2);
  assert.deepEqual((await trashed(ctx)), [[skimmed, v9('11:00:00'), v9('11:00:00')]]);
  // Settlement at commit kept the discard: a read finds the same revision with it.
  assert.deepEqual((await getTimerState(ctx.db, ctx.user, at('11:00:10'))), state);

  // End sends the next one to the trash too.
  before = state;
  state = (await endPomodoro(ctx.db, ctx.user, state.revision, at('11:00:20')));
  assertOneChange(ctx, before, state, 'End on a pomodoro too short to keep');
  assert.equal(state.pomodoro, null);
  assert.deepEqual(state.discarded_pomodoro, { entry_id: next.id, start: iso('11:00:00'), stop: iso('11:00:00') });
  assert.deepEqual((await getTimerState(ctx.db, ctx.user, at('11:00:20'))), state);
  assert.deepEqual((await trashed(ctx)).map(([id]) => id).sort(), [skimmed, next.id].sort());
  assert.deepEqual((await stored(ctx)).map(({ id }) => id), [written], 'the stored entries are the ones kept before');
});

test('pause, resume and pause again add up the stored seconds, and discard ends the chain without an entry', async () => {
  const ctx = (await sessionSetup());
  const ws = `/api/v9/workspaces/${ctx.wid}`;
  const project = (await ctx.json('POST', `${ws}/projects`, { name: 'Alpha' })).body.id as number;
  // Deleting a tag must remove it from the chain before any new tag is created.
  const calls = (await ctx.json('POST', `${ws}/tags`, { name: 'calls' })).body.id as number;
  const deep = (await ctx.json('POST', `${ws}/tags`, { name: 'deep' })).body.id as number;
  const started = await ctx.json('POST', `${ws}/time_entries`, {
    start: v9('09:00:00'), duration: -1, description: 'Support', project_id: project, tag_ids: [deep, calls], billable: true,
  });
  assert.equal(started.status, 200);
  ctx.published();

  // Pause stops the entry and keeps the fields Resume clones, with the seconds the entry stored.
  let before = (await getTimerState(ctx.db, ctx.user, at('09:05:00')));
  let state = (await pauseTimer(ctx.db, ctx.user, at('09:10:00')));
  assertOneChange(ctx, before, state, 'pause');
  const fields = {
    workspace_id: ctx.wid, description: 'Support', project_id: project, task_id: null,
    tag_ids: [calls, deep], tags: ['calls', 'deep'], billable: true,
  };
  assert.equal(state.running_entry, null);
  assert.deepEqual(state.pause, { paused: true, seconds: 600, ...fields, clone_entry_id: null });

  // Resume starts a clone at the confirm instant and keeps the chain.
  before = state;
  state = (await resumeTimer(ctx.db, ctx.user, state.revision, at('09:15:00')));
  assertOneChange(ctx, before, state, 'resume');
  const clone = state.running_entry!;
  assert.deepEqual(
    [clone.start, clone.description, clone.project_id, clone.tag_ids, clone.billable],
    [v9('09:15:00'), 'Support', project, [calls, deep], true],
  );
  assert.deepEqual(state.pause, { paused: false, seconds: 600, ...fields, clone_entry_id: clone.id });

  // Pausing the clone extends the chain.
  before = state;
  state = (await pauseTimer(ctx.db, ctx.user, at('09:20:00')));
  assertOneChange(ctx, before, state, 'pause of the clone');
  assert.deepEqual(state.pause, { paused: true, seconds: 900, ...fields, clone_entry_id: null });

  // A tag deleted while paused leaves the chain and stays out when another tag is created.
  before = state;
  assert.equal((await ctx.json('DELETE', `${ws}/tags/${deep}`)).status, 200);
  state = (await getTimerState(ctx.db, ctx.user, at('09:21:00')));
  assertOneChange(ctx, before, state, 'tag delete');
  assert.deepEqual([state.pause?.tag_ids, state.pause?.tags], [[calls], ['calls']]);
  const fresh = await ctx.json('POST', `${ws}/tags`, { name: 'fresh' });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.name, 'fresh');
  state = (await resumeTimer(ctx.db, ctx.user, (await getTimerState(ctx.db, ctx.user, at('09:25:00'))).revision, at('09:25:00')));
  assert.deepEqual(state.running_entry?.tag_ids, [calls]);
  const kept = { ...fields, tag_ids: [calls], tags: ['calls'] };

  // A pause too short to keep sends the clone to the trash and adds nothing.
  const short = state.running_entry!.id;
  state = (await pauseTimer(ctx.db, ctx.user, at('09:25:10')));
  assert.deepEqual(state.pause, { paused: true, seconds: 900, ...kept, clone_entry_id: null });
  assert.deepEqual((await trashed(ctx)).map(([id]) => id), [short]);

  // A start that is not a resume ends the chain, so pausing that entry starts a new one.
  const email = await ctx.json('POST', `${ws}/time_entries`, { start: v9('09:40:00'), duration: -1, description: 'Email' });
  assert.equal(email.status, 200);
  assert.equal((await getTimerState(ctx.db, ctx.user, at('09:41:00'))).pause, null);
  state = (await pauseTimer(ctx.db, ctx.user, at('09:45:00')));
  assert.deepEqual(state.pause, {
    paused: true, seconds: 300, workspace_id: ctx.wid, description: 'Email', project_id: null, task_id: null,
    tag_ids: [], tags: [], billable: false, clone_entry_id: null,
  });

  // Discard ends the chain and writes nothing.
  ctx.published();
  before = state;
  state = (await discardPause(ctx.db, ctx.user, state.revision, at('09:50:00')));
  assertOneChange(ctx, before, state, 'discard');
  assert.deepEqual([state.pause, state.running_entry], [null, null]);
  assert.deepEqual((await stored(ctx)).map(({ description, start, stop }) => [description, start, stop]), [
    ['Support', v9('09:00:00'), v9('09:10:00')],
    ['Support', v9('09:15:00'), v9('09:20:00')],
    ['Email', v9('09:40:00'), v9('09:45:00')],
  ]);
});

/**
 * Asserts that `action` at `now` is refused with a 409 that carries the state as it stands, and
 * that the refusal changed nothing and published nothing.
 */
async function assertRefused(ctx: SessionContext, label: string, now: Date, action: (now: Date) => Promise<TimerState>): Promise<void> {
  const current = (await getTimerState(ctx.db, ctx.user, now));
  ctx.published();
  await assert.rejects(() => action(now), (error: unknown) => {
    assert.ok(error instanceof ConflictWithBody, `${label}: ${String(error)}`);
    assert.equal(error.status, 409, label);
    assert.deepEqual(error.body, current, label);
    return true;
  });
  assert.deepEqual((await getTimerState(ctx.db, ctx.user, now)), current, label);
  assert.equal(ctx.published(), 0, label);
}

test('a refused action gets a 409 with the current state and changes nothing', async () => {
  const ctx = (await sessionSetup());
  const { db, user } = ctx;

  // Nothing runs: no session to change, nothing to pause, no chain to resume or discard.
  const idle = at('08:00:00');
  (await assertRefused(ctx, 'Next phase without a session', idle, async (now) => (await nextPomodoroPhase(db, user, 0, now))));
  (await assertRefused(ctx, 'End without a session', idle, async (now) => (await endPomodoro(db, user, 0, now))));
  (await assertRefused(ctx, 'pause with nothing running', idle, async (now) => (await pauseTimer(db, user, now))));
  (await assertRefused(ctx, 'resume without a chain', idle, async (now) => (await resumeTimer(db, user, 0, now))));
  (await assertRefused(ctx, 'discard without a chain', idle, async (now) => (await discardPause(db, user, 0, now))));

  // A revision that is not an integer is a bad request, whatever the state.
  for (const revision of ['0', 0.5, 1e400, null, undefined, true]) {
    for (const action of [nextPomodoroPhase, endPomodoro, resumeTimer, discardPause]) {
      await assert.rejects(() => action(db, user, revision, idle), (error: unknown) =>
        error instanceof HttpError && !(error instanceof ConflictWithBody) && error.status === 400
          && error.message === 'Invalid revision: expected an integer', `${action.name}(${String(revision)})`);
    }
  }

  let state = (await startPomodoro(db, user, {}, at('09:00:00')));
  (await assertRefused(ctx, 'a second session', at('09:00:10'), async (now) => (await startPomodoro(db, user, {}, now))));
  (await assertRefused(ctx, 'pause during a session', at('09:00:10'), async (now) => (await pauseTimer(db, user, now))));
  (await assertRefused(ctx, 'resume during a session', at('09:00:10'), async (now) => (await resumeTimer(db, user, state.revision, now))));

  // Two devices confirm Next phase on the revision they both saw: the first one advances the
  // session, and the second is refused instead of skipping a phase.
  const seen = state.revision;
  state = (await nextPomodoroPhase(db, user, seen, at('09:01:00')));
  assert.equal(state.pomodoro?.phase.kind, 'shortRest');
  const later = at('09:01:01');
  (await assertRefused(ctx, 'a second confirm on the same revision', later, async (now) => (await nextPomodoroPhase(db, user, seen, now))));
  (await assertRefused(ctx, 'End on a stale revision', later, async (now) => (await endPomodoro(db, user, seen, now))));
  (await assertRefused(ctx, 'a revision ahead of the current one', later, async (now) => (await nextPomodoroPhase(db, user, state.revision + 1, now))));
  (await assertRefused(ctx, 'a negative revision', later, async (now) => (await nextPomodoroPhase(db, user, -1, now))));
  state = (await nextPomodoroPhase(db, user, state.revision, at('09:02:00')));
  assert.equal(state.pomodoro?.phase.kind, 'work');
  state = (await endPomodoro(db, user, state.revision, at('09:03:00')));

  // Resume and Discard need the current revision, and a chain that is paused.
  const timer = await ctx.json('POST', `/api/v9/workspaces/${ctx.wid}/time_entries`, { start: v9('10:00:00'), duration: -1 });
  assert.equal(timer.status, 200);
  const paused = (await pauseTimer(db, user, at('10:10:00')));
  const stale = paused.revision - 1;
  (await assertRefused(ctx, 'resume on a stale revision', at('10:11:00'), async (now) => (await resumeTimer(db, user, stale, now))));
  (await assertRefused(ctx, 'discard on a stale revision', at('10:11:00'), async (now) => (await discardPause(db, user, stale, now))));
  state = (await resumeTimer(db, user, paused.revision, at('10:15:00')));
  (await assertRefused(ctx, 'resume while the clone runs', at('10:16:00'), async (now) => (await resumeTimer(db, user, state.revision, now))));
  (await assertRefused(ctx, 'discard while the clone runs', at('10:16:00'), async (now) => (await discardPause(db, user, state.revision, now))));
});

test('starting a session stops the running timer at the session start and ends a pause chain', async () => {
  const ctx = (await sessionSetup());
  const { db, user } = ctx;
  const entries = `/api/v9/workspaces/${ctx.wid}/time_entries`;
  const startTimer = async (time: string, description: string) =>
    (await ctx.json('POST', entries, { start: v9(time), duration: -1, description })).body.id as number;

  // The running timer stops where the session starts, snapped, while the pomodoro keeps the exact instant.
  const timer = (await startTimer('09:00:00', 'Email'));
  let state = (await startPomodoro(db, user, { description: 'Focus' }, at('09:10:20')));
  assert.deepEqual((await stored(ctx)).map(({ id, description, start, stop }) => [id, description, start, stop]), [
    [timer, 'Email', v9('09:00:00'), v9('09:10:00')],
    [state.running_entry!.id, 'Focus', v9('09:10:20'), null],
  ]);
  assert.equal(state.running_entry!.workspace_id, ctx.wid, 'the default workspace');
  assert.equal(state.pomodoro?.pomodoro_start, iso('09:10:20'));
  (await endPomodoro(db, user, state.revision, at('09:30:00')));

  // A paused chain ends.
  (await startTimer('10:00:00', 'Call'));
  assert.equal((await pauseTimer(db, user, at('10:05:00'))).pause?.paused, true);
  state = (await startPomodoro(db, user, { description: 'Focus' }, at('10:06:00')));
  assert.deepEqual([state.pause, state.pomodoro?.phase.kind, state.running_entry?.description], [null, 'work', 'Focus']);
  (await endPomodoro(db, user, state.revision, at('10:30:00')));

  // So does a resumed one, whose clone stops at the session start.
  (await startTimer('11:00:00', 'Review'));
  const paused = (await pauseTimer(db, user, at('11:05:00')));
  const clone = (await resumeTimer(db, user, paused.revision, at('11:10:00'))).running_entry!.id;
  state = (await startPomodoro(db, user, {}, at('11:20:00')));
  assert.equal(state.pause, null);
  assert.equal((await stored(ctx)).find(({ id }) => id === clone)?.stop, v9('11:20:00'));
  (await endPomodoro(db, user, state.revision, at('11:30:00')));

  // A session may start in another workspace the user belongs to, and never in one it does not.
  const bob = (await addUser(ctx, { email: 'bob@example.com', role: 'user' }));
  const before = (await getTimerState(db, user, at('12:00:00')));
  await assert.rejects(async () => (await startPomodoro(db, user, { workspace_id: bob.wid }, at('12:00:00'))),
    (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.deepEqual((await getTimerState(db, user, at('12:00:00'))), before);
  (await addWorkspaceMember(db, bob.wid, user.id, 'member'));
  state = (await startPomodoro(db, user, { workspace_id: bob.wid }, at('12:00:00')));
  assert.equal(state.running_entry?.workspace_id, bob.wid);
});

test('a session takes each length from the start body, or else from the preferences', async () => {
  const ctx = (await sessionSetup());
  const { db, user } = ctx;
  const lengths = ({ pomodoro }: TimerState) => pomodoro && [
    pomodoro.work_minutes, pomodoro.short_rest_minutes, pomodoro.long_rest_minutes, pomodoro.long_rest_every,
  ];

  // Without overrides the session takes the user's preferences.
  let state = (await startPomodoro(db, user, {}, at('09:00:00')));
  assert.deepEqual(lengths(state), [1, 1, 1, 2]);
  (await endPomodoro(db, user, state.revision, at('09:01:00')));

  // Each override replaces its preference on its own, and null leaves the preference.
  state = (await startPomodoro(db, user, { work_minutes: 50, long_rest_every: 3, short_rest_minutes: null }, at('10:00:00')));
  assert.deepEqual(lengths(state), [50, 1, 1, 3]);
  assert.equal(state.pomodoro?.phase.planned_end, iso('10:50:00'));
  // The session keeps the lengths it started with when the preferences change.
  assert.equal((await ctx.json('POST', '/api/v9/me/preferences', { pomodoro_break_interval_in_minutes: 7 })).status, 200);
  state = (await nextPomodoroPhase(db, (await getUser(db, user.id))!, state.revision, at('10:50:00')));
  assert.equal(state.pomodoro?.phase.planned_end, iso('10:51:00'));
  (await endPomodoro(db, user, state.revision, at('10:52:00')));

  // An override outside its range is a bad request, and nothing starts.
  const before = (await getTimerState(db, user, at('11:00:00')));
  const invalid: Array<[Record<string, unknown>, string]> = [
    [{ work_minutes: 0 }, 'Invalid work_minutes: expected an integer from 1 to 180'],
    [{ work_minutes: 181 }, 'Invalid work_minutes: expected an integer from 1 to 180'],
    [{ short_rest_minutes: 61 }, 'Invalid short_rest_minutes: expected an integer from 1 to 60'],
    [{ long_rest_minutes: 1.5 }, 'Invalid long_rest_minutes: expected an integer from 1 to 60'],
    [{ long_rest_every: '4' }, 'Invalid long_rest_every: expected an integer from 1 to 12'],
    [{ long_rest_every: 13 }, 'Invalid long_rest_every: expected an integer from 1 to 12'],
  ];
  for (const [body, message] of invalid) {
    await assert.rejects(async () => (await startPomodoro(db, user, body, at('11:00:00'))),
      (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === message, JSON.stringify(body));
  }
  assert.deepEqual((await getTimerState(db, user, at('11:00:00'))), before);
});
