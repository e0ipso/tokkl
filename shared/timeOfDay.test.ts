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

test('an explicit suffix on an end time is never guessed', () => {
  // 10am to 9am: the end stays 9 AM, before the start, so it lands on the next day (23 hours).
  const start = parseTimeOfDay('10am', { twelveHour: true, reference: 600 });
  assert.equal(start, 600);
  assert.equal(parseTimeOfDay('9am', { twelveHour: true, after: 600 }), 540);
  assert.equal(parseTimeOfDay('9pm', { twelveHour: true, after: 1320 }), 1260);
  assert.equal(parseTimeOfDay('12am', { twelveHour: true, after: 600 }), 0);
  assert.equal(parseTimeOfDay('12pm', { twelveHour: true, after: 780 }), 720);
});

test('an unsuffixed 12-hour end is the first occurrence after the start', () => {
  // 11pm to "1" is 1 AM, two hours later across midnight.
  assert.equal(parseTimeOfDay('1', { twelveHour: true, after: 23 * 60 }), 60);
  // 10am to "9" is 9 PM, not 9 AM the next day.
  assert.equal(parseTimeOfDay('9', { twelveHour: true, after: 600 }), 21 * 60);
  // 8pm to "9:30" is 9:30 PM; 1pm to "11" is 11 PM; 9pm to "8" is 8 AM the next day.
  assert.equal(parseTimeOfDay('9:30', { twelveHour: true, after: 20 * 60 }), 21 * 60 + 30);
  assert.equal(parseTimeOfDay('11', { twelveHour: true, after: 13 * 60 }), 23 * 60);
  assert.equal(parseTimeOfDay('8', { twelveHour: true, after: 21 * 60 }), 8 * 60);
  // 9am to "10" is 10 AM; "12" and 0/13-23 are not ambiguous.
  assert.equal(parseTimeOfDay('10', { twelveHour: true, after: 540 }), 600);
  assert.equal(parseTimeOfDay('12', { twelveHour: true, after: 600 }), 720);
  assert.equal(parseTimeOfDay('15', { twelveHour: true, after: 1000 }), 900);
  assert.equal(parseTimeOfDay('0:30', { twelveHour: true, after: 1000 }), 30);
});

test('24-hour input ignores the end-time guess', () => {
  assert.equal(parseTimeOfDay('1', { after: 23 * 60 }), 60);
  assert.equal(parseTimeOfDay('9', { after: 600 }), 540);
  assert.equal(parseTimeOfDay('9', { twelveHour: false, after: 600 }), 540);
  assert.equal(parseTimeOfDay('21:00', { after: 600 }), 1260);
});
