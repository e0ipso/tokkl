import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, parseDuration } from './duration.ts';

test('parseDuration accepts the formats people type', () => {
  const cases: Array<[string, number | null]> = [
    ['1:30', 5400],
    ['0:05:30', 330],
    ['90', 5400],
    ['1.5', 5400],
    ['1,5h', 5400],
    ['1h 30m', 5400],
    ['1h30m', 5400],
    ['2 hours 15 min', 8100],
    ['45s', 45],
    ['', null],
    ['abc', null],
    ['1:75', null],
    ['1x', null],
    ['1h foo', null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseDuration(input), expected, `input ${JSON.stringify(input)}`);
  }
});

test('formatDuration renders each Toggl duration format', () => {
  assert.equal(formatDuration(3906, 'improved'), '1:05:06');
  assert.equal(formatDuration(306, 'improved'), '0:05:06');
  assert.equal(formatDuration(306, 'classic'), '5:06 min');
  assert.equal(formatDuration(6, 'classic'), '6 sec');
  assert.equal(formatDuration(3906, 'classic'), '1:05:06');
  assert.equal(formatDuration(2826, 'decimal'), '0.79 h');
  assert.equal(formatDuration(-5, 'improved'), '0:00:00');
});
