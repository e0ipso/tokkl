import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canStep, stepValue, stepperStatus } from './lengthStepper.ts';

const WORK = { min: 1, max: 180 };

test('status names the limit a value breaks', () => {
  assert.equal(stepperStatus('25', WORK), 'valid');
  assert.equal(stepperStatus(' 1 ', WORK), 'valid');
  assert.equal(stepperStatus('180', WORK), 'valid');
  assert.equal(stepperStatus('181', WORK), 'aboveMax');
  assert.equal(stepperStatus('0', WORK), 'belowMin');
  assert.equal(stepperStatus('', WORK), 'empty');
  assert.equal(stepperStatus('  ', WORK), 'empty');
  assert.equal(stepperStatus('1.5', WORK), 'notWhole');
  assert.equal(stepperStatus('-3', WORK), 'notWhole');
  assert.equal(stepperStatus('abc', WORK), 'notWhole');
});

test('plus and minus step by one inside the range', () => {
  assert.equal(stepValue('25', 1, WORK), 26);
  assert.equal(stepValue('25', -1, WORK), 24);
});

test('plus and minus clamp at the edges', () => {
  assert.equal(stepValue('180', 1, WORK), 180);
  assert.equal(stepValue('1', -1, WORK), 1);
  assert.equal(canStep('180', 1, WORK), false);
  assert.equal(canStep('1', -1, WORK), false);
  assert.equal(canStep('180', -1, WORK), true);
  assert.equal(canStep('1', 1, WORK), true);
});

test('an out-of-range value steps back into the range', () => {
  assert.equal(stepValue('240', -1, WORK), 180);
  assert.equal(stepValue('240', 1, WORK), 180);
  assert.equal(stepValue('0', 1, WORK), 1);
  assert.equal(stepValue('0', -1, WORK), 1);
});

test('text that is not a whole number steps to a whole number', () => {
  assert.equal(stepValue('', 1, WORK), 1);
  assert.equal(stepValue('abc', -1, WORK), 1);
  assert.equal(stepValue('2.5', 1, WORK), 3);
  assert.equal(stepValue('2.5', -1, WORK), 2);
  assert.equal(canStep('', -1, WORK), true);
});
