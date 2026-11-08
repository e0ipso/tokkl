import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instantMilliseconds, isFiniteNumber, isInstant, isSafeInteger } from './validators.ts';

test('instantMilliseconds reads RFC 3339 instants with a zone', () => {
  assert.equal(instantMilliseconds('2026-10-05T10:00:00Z'), Date.UTC(2026, 9, 5, 10));
  assert.equal(instantMilliseconds('2026-10-05T12:00:00+02:00'), Date.UTC(2026, 9, 5, 10));
  assert.equal(instantMilliseconds('2026-10-05T10:00:00.250Z'), Date.UTC(2026, 9, 5, 10, 0, 0, 250));
  assert.equal(instantMilliseconds('2024-02-29T23:59:59-23:59'), Date.parse('2024-02-29T23:59:59-23:59'));
});

test('instantMilliseconds refuses what is not a real instant', () => {
  for (const value of [
    '2026-10-05T10:00:00',
    '2026-10-05 10:00:00Z',
    '2026-10-05t10:00:00z',
    '2026-10-05T10:00Z',
    '2026-02-30T10:00:00Z',
    '2025-02-29T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-10-05T24:00:00Z',
    '2026-10-05T10:60:00Z',
    '2026-10-05T10:00:60Z',
    '2026-10-05T10:00:00+24:00',
    '2026-10-05T10:00:00+01:60',
    '2026-10-05',
    '',
    1_700_000_000_000,
    null,
    undefined,
    new Date(0),
  ])
    assert.equal(instantMilliseconds(value), null, String(value));
});

test('isInstant agrees with instantMilliseconds', () => {
  assert.equal(isInstant('2026-10-05T10:00:00Z'), true);
  assert.equal(isInstant('2026-02-30T10:00:00Z'), false);
  assert.equal(isInstant(0), false);
});

test('isFiniteNumber takes numbers that are neither NaN nor infinite', () => {
  for (const value of [0, -0, 1.5, -3, Number.MAX_VALUE, Number.MIN_VALUE]) assert.equal(isFiniteNumber(value), true);
  for (const value of [NaN, Infinity, -Infinity, '1', null, undefined, true, 1n, {}])
    assert.equal(isFiniteNumber(value), false, String(value));
});

test('isSafeInteger takes integer numbers inside the safe range', () => {
  for (const value of [0, -1, 42, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])
    assert.equal(isSafeInteger(value), true);
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', 1n, null, undefined])
    assert.equal(isSafeInteger(value), false, String(value));
});
