import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ALL_DAY_SECONDS } from './duration.ts';
import { isTimeResolution, snapDuration, snapInstant, snapSpan } from './snap.ts';
import snapFixture from './fixtures/snap.json' with { type: 'json' };

interface SnapCase {
  name: string;
  input: { start: string; stop: string; minutes: number; timeZone: string };
  expected: { start: string; stop: string } | { throws: string } | null;
}

const snapCases: SnapCase[] = snapFixture;
const errors: Record<string, ErrorConstructor> = { RangeError };

for (const { name, input, expected } of snapCases) {
  test(`snapSpan: ${name}`, () => {
    const run = () => snapSpan(new Date(input.start), new Date(input.stop), input.minutes, input.timeZone);
    if (expected !== null && 'throws' in expected) {
      const error = errors[expected.throws];
      assert.ok(error, `unknown error type ${expected.throws}`);
      assert.throws(run, error);
      return;
    }
    const span = run();
    assert.deepEqual(span && { start: span.start.toISOString(), stop: span.stop.toISOString() }, expected);
  });
}

test('snapInstant moves an instant to the nearest grid point, the later one on a tie', () => {
  const at = (iso: string) => snapInstant(new Date(iso), 5, 'UTC').toISOString();
  assert.equal(at('2026-10-14T09:02:29Z'), '2026-10-14T09:00:00.000Z');
  assert.equal(at('2026-10-14T09:02:30Z'), '2026-10-14T09:05:00.000Z');
  assert.throws(() => snapInstant(new Date(), 7, 'UTC'), RangeError);
});

test('snapDuration moves a duration to the nearest step, a tie going up', () => {
  assert.equal(snapDuration(449, 15), 0);
  assert.equal(snapDuration(450, 15), 900);
  assert.equal(snapDuration(1349.9, 15), 900);
  assert.equal(snapDuration(5400, 5), 5400);
  assert.equal(snapDuration(MAX_ALL_DAY_SECONDS, 60), MAX_ALL_DAY_SECONDS);
  assert.equal(MAX_ALL_DAY_SECONDS, 24 * 3600);
});

test('only divisors of 60 are resolutions', () => {
  for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) assert.equal(isTimeResolution(minutes), true, String(minutes));
  for (const minutes of [0, -5, 7, 45, 90, 120, 2.5, Number.NaN]) assert.equal(isTimeResolution(minutes), false, String(minutes));
});
