import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeOfDay } from './timeOfDay.ts';
import timeOfDayFixture from './fixtures/timeOfDay.json' with { type: 'json' };

interface TimeOfDayCase {
  name: string;
  input: string;
  options?: { twelveHour?: boolean; reference?: number; after?: number };
  expected: number | null;
}

const timeOfDayCases: TimeOfDayCase[] = timeOfDayFixture;

for (const { name, input, options, expected } of timeOfDayCases) {
  test(`parseTimeOfDay: ${name}`, () => {
    assert.equal(parseTimeOfDay(input, options), expected);
  });
}
