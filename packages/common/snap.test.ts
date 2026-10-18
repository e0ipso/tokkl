import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTimeResolution, snapSpan } from './snap.ts';
import snapFixture from './fixtures/snap.json' with { type: 'json' };

interface SnapCase {
  name: string;
  input: { start: string; stop: string; minutes: number; timeZone: string };
  expected: { start: string; stop: string } | { throws: string };
}

const snapCases: SnapCase[] = snapFixture;
const errors: Record<string, ErrorConstructor> = { RangeError };

for (const { name, input, expected } of snapCases) {
  test(`snapSpan: ${name}`, () => {
    const run = () => snapSpan(new Date(input.start), new Date(input.stop), input.minutes, input.timeZone);
    if ('throws' in expected) {
      const error = errors[expected.throws];
      assert.ok(error, `unknown error type ${expected.throws}`);
      assert.throws(run, error);
      return;
    }
    const span = run();
    assert.deepEqual({ start: span.start.toISOString(), stop: span.stop.toISOString() }, expected);
  });
}

test('only divisors of 60 are resolutions', () => {
  for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) assert.equal(isTimeResolution(minutes), true, String(minutes));
  for (const minutes of [0, -5, 7, 45, 90, 120, 2.5, Number.NaN]) assert.equal(isTimeResolution(minutes), false, String(minutes));
});
