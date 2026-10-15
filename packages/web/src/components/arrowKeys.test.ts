import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowTarget } from './arrowKeys.ts';

test('arrowTarget steps forward and back, wrapping at both ends', () => {
  assert.equal(arrowTarget('ArrowDown', 0, 3), 1);
  assert.equal(arrowTarget('ArrowRight', 1, 3), 2);
  assert.equal(arrowTarget('ArrowDown', 2, 3), 0);
  assert.equal(arrowTarget('ArrowUp', 2, 3), 1);
  assert.equal(arrowTarget('ArrowLeft', 1, 3), 0);
  assert.equal(arrowTarget('ArrowUp', 0, 3), 2);
});

test('arrowTarget sends Home to the first option and End to the last', () => {
  assert.equal(arrowTarget('Home', 2, 4), 0);
  assert.equal(arrowTarget('End', 0, 4), 3);
  assert.equal(arrowTarget('Home', -1, 4, true), 0);
  assert.equal(arrowTarget('End', -1, 4, true), 3);
});

test('with no active option, Down goes to the first option and Up to the last', () => {
  assert.equal(arrowTarget('ArrowDown', -1, 5, true), 0);
  assert.equal(arrowTarget('ArrowUp', -1, 5, true), 4);
  assert.equal(arrowTarget('ArrowRight', -1, 5), 0);
  assert.equal(arrowTarget('ArrowLeft', -1, 5), 4);
});

test('a single option stays put on every navigation key', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.equal(arrowTarget(key, 0, 1), 0, key);
  }
});

test('an empty list returns null for every key', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.equal(arrowTarget(key, -1, 0), null, key);
    assert.equal(arrowTarget(key, -1, 0, true), null, key);
  }
});

test('a vertical list leaves Left and Right alone', () => {
  assert.equal(arrowTarget('ArrowLeft', 1, 3, true), null);
  assert.equal(arrowTarget('ArrowRight', 1, 3, true), null);
  assert.equal(arrowTarget('ArrowDown', 1, 3, true), 2);
});

test('other keys return null', () => {
  for (const key of ['Enter', ' ', 'Tab', 'Escape', 'PageDown', 'a']) {
    assert.equal(arrowTarget(key, 1, 3), null, key);
  }
});
