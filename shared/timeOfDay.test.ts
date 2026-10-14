import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeOfDay } from './timeOfDay.ts';

test('parseTimeOfDay handles 24-hour input', () => {
  assert.equal(parseTimeOfDay('9'), 540);
  assert.equal(parseTimeOfDay('09:30'), 570);
  assert.equal(parseTimeOfDay('930'), 570);
  assert.equal(parseTimeOfDay('1745'), 1065);
  assert.equal(parseTimeOfDay('17.45'), 1065);
  assert.equal(parseTimeOfDay('23:59:59'), 1439);
  assert.equal(parseTimeOfDay('24'), null);
  assert.equal(parseTimeOfDay('9:75'), null);
  assert.equal(parseTimeOfDay('abc'), null);
});

test('parseTimeOfDay handles suffixes and 12-hour guessing', () => {
  assert.equal(parseTimeOfDay('8a'), 480);
  assert.equal(parseTimeOfDay('4pm'), 960);
  assert.equal(parseTimeOfDay('12am'), 0);
  assert.equal(parseTimeOfDay('12pm'), 720);
  assert.equal(parseTimeOfDay('13pm'), null);
  // At 15:00, "11" means 11 AM and "4" means 4 PM.
  assert.equal(parseTimeOfDay('11', { twelveHour: true, reference: 900 }), 660);
  assert.equal(parseTimeOfDay('4', { twelveHour: true, reference: 900 }), 960);
});
