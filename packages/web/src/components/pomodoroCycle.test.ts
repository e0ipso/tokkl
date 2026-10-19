import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDLE_STATE, advance, countdown, countdownText, forgetPomodoro, nextDeadline, parseState, pomodoroConfig, pomodoroKey, readStored,
  serializeState, writeStored, type PomodoroConfig, type PomodoroState, type PomodoroStorage, type TimerView,
} from './pomodoroCycle.ts';

const T0 = Date.parse('2026-10-19T10:00:00Z');
const minutes = (n: number) => n * 60_000;
const at = (m: number) => T0 + minutes(m);

const ENTRY = 41;
const RUNNING: TimerView = { entryId: ENTRY, resumed: false, paused: false, pausedAt: null };
const PAUSED: TimerView = { entryId: null, resumed: false, paused: true, pausedAt: null };
const STOPPED: TimerView = { entryId: null, resumed: false, paused: false, pausedAt: null };

// 25-minute work phases, 5- and 15-minute breaks, a long break after every second phase.
const STOP_AT_END: PomodoroConfig = {
  settings: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 2 },
  stopAtEnd: true,
};
const KEEP_RUNNING: PomodoroConfig = { ...STOP_AT_END, stopAtEnd: false };

function memoryStorage(seed: Record<string, string> = {}): PomodoroStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

/** Runs the timer views in order, one per instant, and returns the last state and every bell. */
function run(config: PomodoroConfig, steps: Array<[number, TimerView]>, from: PomodoroState = IDLE_STATE) {
  let state = from;
  const rang: number[] = [];
  const workEnded: number[] = [];
  for (const [now, timer] of steps) {
    const result = advance(state, timer, now, config);
    state = result.state;
    if (result.rang) rang.push(now);
    if (result.workEnded) workEnded.push(now);
  }
  return { state, rang, workEnded };
}

test('pomodoroConfig is null with the Pomodoro off and maps the stored preferences otherwise', () => {
  assert.equal(pomodoroConfig(undefined), null);
  assert.equal(pomodoroConfig({ pomodoro_enabled: false, pomodoro_focus_interval_in_minutes: 50 }), null);
  assert.deepEqual(pomodoroConfig({
    pomodoro_enabled: true, pomodoro_focus_interval_in_minutes: 50, pomodoro_break_interval_in_minutes: 10,
    pomodoro_long_break_interval_in_minutes: 30, pomodoro_long_break_every: 3, pomodoro_stop_timer_at_end: false,
  }), { settings: { workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 3 }, stopAtEnd: false });
  // Missing or broken values fall back to the defaults instead of throwing in the timer bar.
  assert.deepEqual(pomodoroConfig({ pomodoro_enabled: true, pomodoro_focus_interval_in_minutes: 0, pomodoro_long_break_every: 2.5 }), {
    settings: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 }, stopAtEnd: true,
  });
});

test('a running timer begins a work phase that counts down from the work length', () => {
  const { state, rang } = run(STOP_AT_END, [[at(0), RUNNING]]);
  assert.deepEqual(state.phase, { type: 'work', start: at(0), accruedMs: 0, since: at(0), entryId: ENTRY });
  assert.deepEqual(rang, []);
  assert.deepEqual(countdown(state, at(0), STOP_AT_END.settings), { phase: 'work', seconds: 1500 });
  assert.deepEqual(countdown(state, at(10) + 500, STOP_AT_END.settings), { phase: 'work', seconds: 900 });
  assert.equal(nextDeadline(state, STOP_AT_END.settings), at(25));
  assert.equal(countdown(IDLE_STATE, at(0), STOP_AT_END.settings), null);
});

test('a pause freezes the work countdown and Resume continues the remaining time', () => {
  const paused = run(STOP_AT_END, [[at(0), RUNNING], [at(10), PAUSED]]).state;
  assert.deepEqual(paused.phase, { type: 'work', start: at(0), accruedMs: minutes(10), since: null, entryId: ENTRY });
  assert.equal(countdown(paused, at(40), STOP_AT_END.settings)!.seconds, 900);
  assert.equal(nextDeadline(paused, STOP_AT_END.settings), null);
  // Paused past the work length, the phase has not ended.
  assert.deepEqual(run(STOP_AT_END, [[at(40), PAUSED]], paused).rang, []);

  const resumed = run(STOP_AT_END, [[at(40), RUNNING]], paused).state;
  assert.deepEqual(resumed.phase, { type: 'work', start: at(0), accruedMs: minutes(10), since: at(40), entryId: ENTRY });
  assert.equal(nextDeadline(resumed, STOP_AT_END.settings), at(55));
  assert.deepEqual(run(STOP_AT_END, [[at(55) - 1, RUNNING]], resumed).rang, []);
  assert.deepEqual(run(STOP_AT_END, [[at(55), RUNNING]], resumed).rang, [at(55)]);
});

test('a pause stops the work time when it began, however late its stop answers', () => {
  const pausedAt = (ms: number): TimerView => ({ ...PAUSED, pausedAt: ms });
  const started = run(STOP_AT_END, [[at(0), RUNNING]]).state;
  // Paused at 20 minutes; the stop answered at 26, past the work length.
  const late = run(STOP_AT_END, [[at(26), pausedAt(at(20))]], started);
  assert.deepEqual(late.rang, []);
  assert.deepEqual(late.state, { ...started, phase: { type: 'work', start: at(0), accruedMs: minutes(20), since: null, entryId: ENTRY } });
  assert.equal(countdown(late.state, at(26), STOP_AT_END.settings)!.seconds, 300);
  // A pause after the work length still ends the phase where it ended.
  const over = run(STOP_AT_END, [[at(27), pausedAt(at(26))]], started);
  assert.deepEqual(over.rang, [at(27)]);
  assert.deepEqual(over.state.phase, { type: 'break', kind: 'short', start: at(25) });
  // A pause instant from before the phase ran again counts nothing more.
  const resumed = run(STOP_AT_END, [[at(30), RUNNING]], late.state).state;
  assert.equal((run(STOP_AT_END, [[at(31), pausedAt(at(20))]], resumed).state.phase as { accruedMs: number }).accruedMs, minutes(20));
});

test('with stop-at-end on, a work phase ends on its length, asks for the pause and starts the break', () => {
  const { state, rang, workEnded } = run(STOP_AT_END, [[at(0), RUNNING], [at(25), RUNNING]]);
  assert.deepEqual(rang, [at(25)]);
  assert.deepEqual(workEnded, [at(25)]);
  assert.deepEqual(state, { completed: 1, phase: { type: 'break', kind: 'short', start: at(25) }, lastActiveAt: at(25), banner: 'work' });
  assert.deepEqual(countdown(state, at(27), STOP_AT_END.settings), { phase: 'short', seconds: 180 });
  assert.equal(nextDeadline(state, STOP_AT_END.settings), at(30));

  // The entry is paused for the break. The break ends on its own and rings; the next phase waits for Resume.
  const ended = run(STOP_AT_END, [[at(25) + 200, PAUSED], [at(30), PAUSED]], state);
  assert.deepEqual(ended.rang, [at(30)]);
  assert.deepEqual(ended.state, { completed: 1, phase: null, lastActiveAt: at(30), banner: 'short' });
  const resumed = run(STOP_AT_END, [[at(33), RUNNING]], ended.state).state;
  assert.deepEqual(resumed.phase, { type: 'work', start: at(33), accruedMs: 0, since: at(33), entryId: ENTRY });
});

test('with stop-at-end off, the break runs beside the entry and the next work phase starts at its end', () => {
  const { state, rang, workEnded } = run(KEEP_RUNNING, [[at(0), RUNNING], [at(25), RUNNING], [at(28), RUNNING]]);
  assert.deepEqual(rang, [at(25)]);
  assert.deepEqual(workEnded, [at(25)]);
  assert.deepEqual(state.phase, { type: 'break', kind: 'short', start: at(25) });
  // A tab that wakes late still starts the next phase at the break's end.
  const next = run(KEEP_RUNNING, [[at(31), RUNNING]], state);
  assert.deepEqual(next.rang, [at(31)]);
  assert.deepEqual(next.state, { completed: 1, phase: { type: 'work', start: at(30), accruedMs: 0, since: at(30), entryId: ENTRY }, lastActiveAt: at(30), banner: 'short' });
  assert.equal(countdown(next.state, at(31), KEEP_RUNNING.settings)!.seconds, 1440);
});

test('a pause or Stop during a break leaves the next work phase to the next running timer', () => {
  const onBreak = run(KEEP_RUNNING, [[at(0), RUNNING], [at(25), RUNNING]]).state;
  for (const view of [PAUSED, STOPPED]) {
    const ended = run(KEEP_RUNNING, [[at(27), view], [at(30), view]], onBreak);
    assert.deepEqual(ended.rang, [at(30)]);
    assert.equal(ended.state.phase, null);
    assert.deepEqual(run(KEEP_RUNNING, [[at(32), RUNNING]], ended.state).state.phase, { type: 'work', start: at(32), accruedMs: 0, since: at(32), entryId: ENTRY });
  }
});

test('the work phase that completes the cycle gets the long break, whose end resets the count', () => {
  const { state, rang } = run(KEEP_RUNNING, [[at(0), RUNNING], [at(25), RUNNING], [at(30), RUNNING], [at(55), RUNNING]]);
  assert.deepEqual(rang, [at(25), at(30), at(55)]);
  assert.deepEqual(state, { completed: 2, phase: { type: 'break', kind: 'long', start: at(55) }, lastActiveAt: at(55), banner: 'work' });
  assert.deepEqual(countdown(state, at(55), KEEP_RUNNING.settings), { phase: 'long', seconds: 900 });
  const after = run(KEEP_RUNNING, [[at(70), RUNNING]], state).state;
  assert.deepEqual(after, { completed: 0, phase: { type: 'work', start: at(70), accruedMs: 0, since: at(70), entryId: ENTRY }, lastActiveAt: at(70), banner: 'long' });
  assert.deepEqual(run(KEEP_RUNNING, [[at(95), RUNNING]], after).state.phase, { type: 'break', kind: 'short', start: at(95) });
});

test('Stop abandons the work phase, keeps the count, and the next start begins a fresh phase', () => {
  const one = run(STOP_AT_END, [[at(0), RUNNING], [at(25), RUNNING], [at(30), PAUSED], [at(31), RUNNING]]).state;
  assert.equal(one.completed, 1);
  const stopped = run(STOP_AT_END, [[at(40), STOPPED]], one);
  assert.deepEqual(stopped.rang, []);
  assert.deepEqual(stopped.state, { ...one, phase: null, lastActiveAt: at(40) });
  // Stop while paused abandons it too.
  const pausedThenStopped = run(STOP_AT_END, [[at(40), PAUSED], [at(41), STOPPED]], one).state;
  assert.deepEqual(pausedThenStopped, { ...one, phase: null, lastActiveAt: at(41) });
  const fresh = run(STOP_AT_END, [[at(45), RUNNING]], stopped.state).state;
  assert.deepEqual(fresh, { ...one, phase: { type: 'work', start: at(45), accruedMs: 0, since: at(45), entryId: ENTRY }, lastActiveAt: at(40) });
});

test('another entry that starts running in place of the phase\'s entry begins a fresh phase, uncounted', () => {
  const OTHER: TimerView = { entryId: 52, resumed: false, paused: false, pausedAt: null };
  const one = run(KEEP_RUNNING, [[at(0), RUNNING], [at(25), RUNNING], [at(30), RUNNING]]).state;
  assert.equal(one.completed, 1);
  // Continue, a favorite or N replaces the running entry 20 minutes into the second phase.
  const replaced = run(KEEP_RUNNING, [[at(50), OTHER]], one);
  assert.deepEqual(replaced.rang, []);
  assert.deepEqual(replaced.state, { ...one, phase: { type: 'work', start: at(50), accruedMs: 0, since: at(50), entryId: 52 }, lastActiveAt: at(50) });
  assert.equal(countdown(replaced.state, at(50), KEEP_RUNNING.settings)!.seconds, 1500);
  // The same goes for a start made while the phase is paused.
  const paused = run(STOP_AT_END, [[at(0), RUNNING], [at(10), PAUSED], [at(12), OTHER]]).state;
  assert.deepEqual(paused.phase, { type: 'work', start: at(12), accruedMs: 0, since: at(12), entryId: 52 });
  assert.equal(paused.completed, 0);
});

test('Resume continues the phase with the chain\'s clone, which has an id of its own', () => {
  const CLONE: TimerView = { entryId: 63, resumed: true, paused: false, pausedAt: null };
  const paused = run(STOP_AT_END, [[at(0), RUNNING], [at(10), PAUSED]]).state;
  const resumed = run(STOP_AT_END, [[at(15), CLONE]], paused).state;
  assert.deepEqual(resumed.phase, { type: 'work', start: at(0), accruedMs: minutes(10), since: at(15), entryId: 63 });
  // Later polls of the clone keep the phase.
  assert.deepEqual(run(STOP_AT_END, [[at(16), { ...CLONE, resumed: true }], [at(17), { entryId: 63, resumed: false, paused: false, pausedAt: null }]], resumed).state.phase,
    resumed.phase);
});

test('a phase stored before it followed an entry takes the running one on', () => {
  const stored: PomodoroState = { ...IDLE_STATE, phase: { type: 'work', start: at(0), accruedMs: 0, since: at(0), entryId: null } };
  assert.deepEqual(run(STOP_AT_END, [[at(5), RUNNING]], stored).state.phase, { type: 'work', start: at(0), accruedMs: 0, since: at(0), entryId: ENTRY });
  assert.deepEqual(parseState('{"v":1,"completed":2,"phase":{"type":"work","start":1,"accruedMs":0,"since":null},"lastActiveAt":null,"banner":null}').phase,
    { type: 'work', start: 1, accruedMs: 0, since: null, entryId: null });
});

test('a timer that starts after an idle spell longer than the long break resets the count', () => {
  const one = run(STOP_AT_END, [[at(0), RUNNING], [at(25), RUNNING], [at(30), PAUSED]]).state;
  assert.equal(one.completed, 1);
  assert.equal(run(STOP_AT_END, [[at(45), RUNNING]], one).state.completed, 1);
  assert.equal(run(STOP_AT_END, [[at(45) + 1, RUNNING]], one).state.completed, 0);
});

test('a tab that wakes after several phases catches up and rings once', () => {
  const started = run(KEEP_RUNNING, [[at(0), RUNNING]]).state;
  const late = run(KEEP_RUNNING, [[at(62), RUNNING]], started);
  assert.deepEqual(late.rang, [at(62)]);
  // Work to 25, short break to 30, work to 55, long break to 70.
  assert.deepEqual(late.state, { completed: 2, phase: { type: 'break', kind: 'long', start: at(55) }, lastActiveAt: at(55), banner: 'work' });
  // With stop-at-end on, the cycle stops at the first break: the entry is being paused.
  const stopping = run(STOP_AT_END, [[at(62), RUNNING]], started);
  assert.deepEqual(stopping.state, { completed: 1, phase: null, lastActiveAt: at(30), banner: 'short' });
  assert.deepEqual(stopping.workEnded, [at(62)]);
});

test('countdownText shows minutes and seconds, and hours from an hour up', () => {
  assert.equal(countdownText(0), '0:00');
  assert.equal(countdownText(59), '0:59');
  assert.equal(countdownText(1500), '25:00');
  assert.equal(countdownText(3600), '1:00:00');
  assert.equal(countdownText(10_799), '2:59:59');
});

test('stored state round-trips per account, and unreadable text reads as a fresh cycle', () => {
  const storage = memoryStorage();
  const state: PomodoroState = { completed: 3, phase: { type: 'work', start: at(0), accruedMs: 1234, since: null, entryId: ENTRY }, lastActiveAt: at(-5), banner: 'long' };
  assert.equal(writeStored(storage, 7, state), serializeState(state));
  assert.deepEqual(parseState(readStored(storage, 7)!), state);
  assert.equal(readStored(storage, 8), null);
  assert.equal(writeStored(storage, 7, IDLE_STATE), null);
  assert.equal(storage.map.has(pomodoroKey(7)), false);

  for (const text of ['nope', '{}', '{"v":2,"completed":0,"phase":null,"lastActiveAt":null,"banner":null}',
    '{"v":1,"completed":-1,"phase":null,"lastActiveAt":null,"banner":null}',
    '{"v":1,"completed":0,"phase":{"type":"break","kind":"medium","start":1},"lastActiveAt":null,"banner":null}',
    '{"v":1,"completed":0,"phase":null,"lastActiveAt":null,"banner":"lunch"}']) {
    assert.deepEqual(parseState(text), IDLE_STATE, text);
  }
});

test('blocked storage reads and writes as undefined, and sign-out forgets every account', () => {
  const blocked: PomodoroStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
    length: 0,
    key: () => null,
  };
  assert.equal(readStored(blocked, 1), undefined);
  assert.equal(writeStored(blocked, 1, { ...IDLE_STATE, completed: 1 }), undefined);
  assert.doesNotThrow(() => forgetPomodoro(blocked));

  const storage = memoryStorage({ [pomodoroKey(1)]: 'a', [pomodoroKey(2)]: 'b', 'tokkl.pauseChain.1': 'c' });
  forgetPomodoro(storage);
  assert.deepEqual([...storage.map.keys()], ['tokkl.pauseChain.1']);
});
