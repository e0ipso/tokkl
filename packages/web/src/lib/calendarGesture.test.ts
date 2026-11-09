import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimeEntry } from '@tokkl/types';
import {
  IDLE,
  LONG_PRESS_TOLERANCE_PX,
  followPointer,
  isHolding,
  stepGesture,
  type CalendarDrag,
  type GestureEvent,
  type GestureState,
} from './calendarGesture.ts';
import { HOUR_HEIGHT } from './calendarLayout.ts';

const entry = { id: 3, start: '2026-06-22T07:00:00.000Z', stop: '2026-06-22T08:00:00.000Z' } as TimeEntry;
const create: CalendarDrag = { kind: 'create', day: '2026-06-22', fromMinute: 540, toMinute: 540 };
const move: CalendarDrag = {
  kind: 'move',
  entry,
  day: '2026-06-22',
  originY: 400,
  startMinute: 540,
  endMinute: 600,
  deltaMinutes: 0,
};

const down = (pointerType: string, next: CalendarDrag, at = { x: 100, y: 400 }): GestureEvent => ({
  type: 'down',
  pointerType,
  pointerId: 1,
  next,
  ...at,
});

/** Runs `events` from `state` and returns the last state and every outcome kind on the way. */
function run(state: GestureState, ...events: GestureEvent[]) {
  const outcomes: string[] = [];
  for (const event of events) {
    const step = stepGesture(state, event);
    state = step.state;
    outcomes.push(step.outcome.kind);
  }
  return { state, outcomes };
}

test('a mouse or pen drag starts at once', () => {
  for (const pointerType of ['mouse', 'pen']) {
    const { state, outcomes } = run(IDLE, down(pointerType, move));
    assert.equal(state.drag, move);
    assert.equal(state.press, null);
    assert.deepEqual(outcomes, ['none']);
  }
});

test('a touch is held first and becomes a drag when the hold runs out', () => {
  const held = run(IDLE, down('touch', move));
  assert.equal(held.state.drag, null);
  assert.deepEqual(held.state.press, { next: move, pointerId: 1, x: 100, y: 400 });
  assert.equal(isHolding(held.state), true);

  const { state, outcomes } = run(held.state, { type: 'held' });
  assert.equal(state.drag, move);
  assert.equal(state.press, null);
  assert.deepEqual(outcomes, ['hold']);
  // A late timer with no press left changes nothing.
  assert.deepEqual(run(state, { type: 'held' }), { state, outcomes: ['none'] });
});

test('a held touch that wanders past the tolerance is a scroll, not a drag', () => {
  const held = run(IDLE, down('touch', move)).state;
  const near = { type: 'wander', pointerId: 1, x: 100 + LONG_PRESS_TOLERANCE_PX, y: 400 } as const;
  assert.equal(run(held, near).state, held);
  // Another finger moving does not count.
  assert.equal(run(held, { type: 'wander', pointerId: 2, x: 500, y: 900 }).state, held);
  const far = run(held, { type: 'wander', pointerId: 1, x: 108, y: 408 });
  assert.equal(far.state.press, null);
  assert.equal(isHolding(far.state), false);
});

test('a touch that lifts before the hold opens a block like a click, and does nothing on a slot', () => {
  const tapped = stepGesture(run(IDLE, down('touch', move)).state, { type: 'up' });
  assert.deepEqual(tapped, { state: IDLE, outcome: { kind: 'tap', entry } });
  const slot = stepGesture(run(IDLE, down('touch', create)).state, { type: 'up' });
  assert.deepEqual(slot, { state: IDLE, outcome: { kind: 'none' } });
});

test('a drag drops once, even when pointer up and pointer leave arrive together', () => {
  const { state, outcomes } = run(IDLE, down('mouse', move), { type: 'up' }, { type: 'up' });
  assert.equal(state, IDLE);
  assert.deepEqual(outcomes, ['none', 'drop', 'none']);
  assert.deepEqual(stepGesture(run(IDLE, down('mouse', move)).state, { type: 'up' }).outcome, {
    kind: 'drop',
    drag: move,
  });
});

test('a cancel drops the hold and the drag without saving', () => {
  assert.deepEqual(run(IDLE, down('touch', move), { type: 'cancel' }), { state: IDLE, outcomes: ['none', 'none'] });
  assert.deepEqual(run(IDLE, down('mouse', move), { type: 'cancel' }).state, IDLE);
});

test('the pointer moves only an active drag', () => {
  const moved = { ...move, deltaMinutes: 30 };
  assert.equal(run(IDLE, { type: 'follow', drag: moved }).state, IDLE);
  assert.equal(run(IDLE, down('mouse', move), { type: 'follow', drag: moved }).state.drag, moved);
  // A touch still being held keeps its hold; the drag starts only when the hold runs out.
  const held = run(IDLE, down('touch', move)).state;
  assert.equal(run(held, { type: 'follow', drag: moved }).state, held);
});

test('a create drag follows the pointer on its own day in whole steps', () => {
  const pointer = (minute: number, day = '2026-06-22') => ({ day, minute, y: 0 });
  assert.deepEqual(followPointer(create, pointer(607), 15, false), { ...create, toMinute: 600 });
  assert.equal(followPointer(create, pointer(546), 15, false), create);
  assert.equal(followPointer(create, pointer(700, '2026-06-23'), 15, false), create);
  // The range stays on the day.
  assert.deepEqual(followPointer(create, pointer(1500), 15, false), { ...create, toMinute: 1440 });
});

test('a move or resize follows the pointer travel in whole steps; a day-mode move stays on the day', () => {
  const travel = (minutes: number) => ({
    day: '2026-06-22',
    minute: 0,
    y: move.originY + (minutes / 60) * HOUR_HEIGHT,
  });
  assert.deepEqual(followPointer(move, travel(37), 15, false), { ...move, deltaMinutes: 30 });
  assert.equal(followPointer(move, travel(5), 15, false), move);
  // The week view lets a block cross midnight; day mode stops it at the day's end.
  assert.equal((followPointer(move, travel(900), 15, false) as typeof move).deltaMinutes, 900);
  assert.equal((followPointer(move, travel(900), 15, true) as typeof move).deltaMinutes, 840);
  const resize = { ...move, kind: 'resize' as const };
  assert.equal((followPointer(resize, travel(900), 15, true) as typeof move).deltaMinutes, 900);
});
