import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferenceProblem, timeResolutionOf } from '../src/domain/accountValues.ts';
import type { User } from '../src/domain/model.ts';

const userWith = (preferences: User['preferences']) => ({ preferences }) as User;

test('the time resolution preference accepts each divisor of 60 and refuses other values', () => {
  for (const value of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60])
    assert.equal(preferenceProblem('time_resolution_minutes', value), undefined, String(value));
  for (const value of [0, 7, 61, 5.5, '15', null, true])
    assert.equal(
      preferenceProblem('time_resolution_minutes', value),
      'Invalid time_resolution_minutes: expected one of 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60',
      JSON.stringify(value),
    );
});

test("a user's time resolution is the stored preference, else 5", () => {
  assert.equal(timeResolutionOf(userWith({ time_resolution_minutes: 15 })), 15);
  assert.equal(timeResolutionOf(userWith({})), 5);
  assert.equal(timeResolutionOf(userWith({ time_resolution_minutes: 7 })), 5);
  assert.equal(timeResolutionOf(userWith({ time_resolution_minutes: '15' })), 5);
});
