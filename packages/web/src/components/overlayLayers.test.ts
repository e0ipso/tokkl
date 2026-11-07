import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayStack } from './overlayLayers.ts';

test('the last layer pushed is the topmost until it is removed', () => {
  const stack = createOverlayStack();
  const modal = Symbol('modal');
  const popover = Symbol('popover');
  assert.equal(stack.isOpen(), false);
  stack.push(modal);
  const closePopover = stack.push(popover);
  assert.equal(stack.isTopmost(popover), true);
  assert.equal(stack.isTopmost(modal), false);
  closePopover();
  assert.equal(stack.isTopmost(modal), true);
  assert.equal(stack.isOpen(), true);
});

test('a layer removed out of order leaves the others in place', () => {
  const stack = createOverlayStack();
  const first = Symbol('first');
  const second = Symbol('second');
  const removeFirst = stack.push(first);
  stack.push(second);
  removeFirst();
  removeFirst();
  assert.equal(stack.isTopmost(second), true);
  assert.equal(stack.isOpen(), true);
});
