import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, parseDuration } from './duration.ts';
import durationFixture from './fixtures/duration.json' with { type: 'json' };

interface DurationCase {
  name: string;
  input: string;
  expected: number | null;
}

const durationCases: DurationCase[] = durationFixture;

for (const { name, input, expected } of durationCases) {
  test(`parseDuration: ${name}`, () => {
    assert.equal(parseDuration(input), expected);
  });
}

test('formatDuration renders each Toggl duration format', () => {
  assert.equal(formatDuration(3906, 'improved'), '1:05:06');
  assert.equal(formatDuration(306, 'improved'), '0:05:06');
  assert.equal(formatDuration(306, 'classic'), '5:06 min');
  assert.equal(formatDuration(6, 'classic'), '6 sec');
  assert.equal(formatDuration(3906, 'classic'), '1:05:06');
  assert.equal(formatDuration(2826, 'decimal'), '0.79 h');
  assert.equal(formatDuration(-5, 'improved'), '0:00:00');
});
