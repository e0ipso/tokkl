import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignLanes, heightClearingMarkers, type LaneBlock } from './calendarLanes.ts';

interface Named extends LaneBlock {
  name: string;
}

/** A block named `name` on [top, bottom] in clock minutes. */
function block(name: string, top: number, bottom: number): Named {
  return { name, top, bottom, lane: 0, lanes: 1 };
}

/** Each block's `name:lane/lanes`, in the order assignLanes returns them. */
function placed(blocks: Named[]): string[] {
  return assignLanes(blocks).map((b) => `${b.name}:${b.lane}/${b.lanes}`);
}

// 09:00 is minute 540.
test('a zero-length entry shares the lane of the entry that starts where it ends', () => {
  assert.deepEqual(placed([block('switch', 540, 540), block('next', 540, 600)]), ['switch:0/1', 'next:0/1']);
});

test('the order the entries arrive in does not split a zero-length entry from its successor', () => {
  // The shorter span goes first at the same start, however the input is ordered.
  assert.deepEqual(placed([block('next', 540, 600), block('switch', 540, 540)]), ['switch:0/1', 'next:0/1']);
});

test('a zero-length entry at the end of an entry stays out of its lane count', () => {
  assert.deepEqual(placed([block('first', 480, 540), block('switch', 540, 540)]), ['first:0/1', 'switch:0/1']);
});

test('a very short entry that only touches its successor stays in its lane', () => {
  // Two minutes at a 1-minute resolution is shorter than the calendar draws a block.
  assert.deepEqual(placed([block('short', 540, 542), block('next', 542, 600)]), ['short:0/1', 'next:0/1']);
  assert.deepEqual(placed([block('next', 542, 600), block('short', 540, 542)]), ['short:0/1', 'next:0/1']);
});

test('a short entry that does not reach its successor stays in its lane too', () => {
  assert.deepEqual(placed([block('short', 540, 542), block('next', 543, 600)]), ['short:0/1', 'next:0/1']);
});

test('entries whose stored spans overlap split into lanes', () => {
  assert.deepEqual(placed([block('a', 540, 600), block('b', 570, 630)]), ['a:0/2', 'b:1/2']);
  assert.deepEqual(placed([block('b', 570, 630), block('a', 540, 600)]), ['a:0/2', 'b:1/2']);
  // Two entries with the same span overlap fully.
  assert.deepEqual(placed([block('a', 540, 600), block('b', 540, 600)]), ['a:0/2', 'b:1/2']);
});

test('a zero-length entry inside another entry takes a lane beside it', () => {
  assert.deepEqual(placed([block('long', 540, 600), block('switch', 570, 570)]), ['long:0/2', 'switch:1/2']);
  // The entry that starts where the zero-length one sits reuses its lane.
  assert.deepEqual(
    placed([block('long', 500, 600), block('switch', 540, 540), block('next', 540, 560)]),
    ['long:0/2', 'switch:1/2', 'next:1/2'],
  );
});

test('a zero-length entry where one entry ends inside another takes the lane that just ended', () => {
  assert.deepEqual(
    placed([block('a', 540, 600), block('b', 570, 630), block('switch', 600, 600)]),
    ['a:0/2', 'b:1/2', 'switch:0/2'],
  );
});

test('a lane is reused once its block ends, and each cluster counts its own lanes', () => {
  assert.deepEqual(
    placed([block('a', 480, 540), block('b', 500, 520), block('c', 520, 560), block('d', 600, 660)]),
    ['a:0/2', 'b:1/2', 'c:1/2', 'd:0/1'],
  );
});

test('zero-length entries at one instant take separate lanes', () => {
  assert.deepEqual(placed([block('one', 540, 540), block('two', 540, 540)]), ['one:0/2', 'two:1/2']);
  assert.deepEqual(
    placed([block('one', 540, 540), block('two', 540, 540), block('three', 540, 540)]),
    ['one:0/3', 'two:1/3', 'three:2/3'],
  );
});

test('zero-length entries at different instants stay in one lane', () => {
  assert.deepEqual(placed([block('one', 540, 540), block('two', 545, 545)]), ['one:0/1', 'two:0/1']);
});

test('zero-length entries at one instant do not widen the entry that starts there or the one that ends there', () => {
  assert.deepEqual(
    placed([block('next', 540, 600), block('two', 540, 540), block('one', 540, 540)]),
    ['two:0/2', 'one:1/2', 'next:0/1'],
  );
  assert.deepEqual(
    placed([block('before', 480, 540), block('one', 540, 540), block('two', 540, 540)]),
    ['before:0/1', 'one:0/2', 'two:1/2'],
  );
});

test('zero-length entries at one instant inside a longer entry each take a lane beside it', () => {
  assert.deepEqual(
    placed([block('long', 500, 600), block('one', 540, 540), block('two', 540, 540)]),
    ['long:0/3', 'one:1/3', 'two:2/3'],
  );
});

test('no blocks, no lanes', () => {
  assert.deepEqual(assignLanes([]), []);
});

// An hour is 48px, so a minute is 0.8px, and a block is never drawn under 6px.
const PX_PER_MINUTE = 48 / 60;
const MIN_HEIGHT = 6;

/** The height each named block needs, after laying the blocks out. */
function clearances(blocks: Named[]): Record<string, number> {
  const laid = assignLanes(blocks);
  return Object.fromEntries(laid.map((b) => [b.name, heightClearingMarkers(b, laid, PX_PER_MINUTE, MIN_HEIGHT)]));
}

test('a block that starts with a zero-length entry is drawn tall enough to show below it', () => {
  assert.deepEqual(clearances([block('switch', 540, 540), block('short', 540, 545)]), { switch: 6, short: 12 });
  assert.deepEqual(clearances([block('short', 540, 550), block('switch', 540, 540)]), { switch: 6, short: 12 });
  // A longer block gets the same floor, which its own height already clears.
  assert.deepEqual(clearances([block('switch', 540, 540), block('next', 540, 600)]), { switch: 6, next: 12 });
});

test('a block that starts just under a zero-length entry keeps the rest of the marker clear', () => {
  // Four minutes is 3.2px under the marker's top, leaving 2.8px of the marker's 6px to cover it.
  const near = clearances([block('switch', 540, 540), block('short', 544, 549)]);
  assert.ok(Math.abs(near.short! - 8.8) < 1e-9, String(near.short));
  // From 7.5 minutes down the marker no longer reaches the block.
  assert.deepEqual(clearances([block('switch', 540, 540), block('short', 548, 553)]), { switch: 6, short: 6 });
});

test('only zero-length entries at or above a block, in its part of the column, raise its height', () => {
  // The marker is below the block, so it never covers it.
  assert.deepEqual(clearances([block('short', 540, 545), block('switch', 545, 545)]), { short: 6, switch: 6 });
  // The marker sits in the other lane of a longer entry, beside the block.
  const beside = assignLanes([block('long', 500, 600), block('switch', 540, 540), block('inner', 540, 545)]);
  assert.deepEqual(beside.map((b) => `${b.name}:${b.lane}/${b.lanes}`), ['long:0/2', 'switch:1/2', 'inner:1/2']);
  assert.equal(heightClearingMarkers(beside[0]!, beside, PX_PER_MINUTE, MIN_HEIGHT), 6);
  assert.equal(heightClearingMarkers(beside[2]!, beside, PX_PER_MINUTE, MIN_HEIGHT), 12);
  // Several markers at one instant sit side by side and still cover the whole width of the block.
  assert.deepEqual(
    clearances([block('one', 540, 540), block('two', 540, 540), block('short', 540, 545)]),
    { one: 6, two: 6, short: 12 },
  );
});
