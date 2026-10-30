import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeInteger, entityId, finiteNumber, booleanValue, jsonValue, jsonObject, utcInstant, dateOnly } from '../../src/storage/conversion.ts';

test('IDs and integer counts reject overflow, coercions and partial strings', () => {
  for (const value of [1, 1n, '1']) assert.equal(entityId(value), 1);
  assert.equal(safeInteger('-42'), -42);
  assert.equal(safeInteger('9007199254740991'), Number.MAX_SAFE_INTEGER);
  for (const value of [null, undefined, true, '', '1.2', '1e2', ' 1', '12x', 1.2, NaN, Infinity, '9007199254740992', 9007199254740992n]) {
    assert.throws(() => safeInteger(value), /Invalid storage integer/);
  }
  for (const value of [0, -1, '-2']) assert.throws(() => entityId(value));
});

test('decimal rates and boolean variants normalize without truthiness', () => {
  assert.equal(finiteNumber('12.50'), 12.5);
  assert.equal(finiteNumber(0), 0);
  for (const value of ['', ' ', '0x10', null, true, Infinity, 'NaN', '1e999']) assert.throws(() => finiteNumber(value));
  for (const value of [1e100, Number.MAX_VALUE, '9007199254740992', '1e100']) assert.equal(finiteNumber(value), Number(value));
  for (const value of [true, 1, 1n, '1', 't', 'true']) assert.equal(booleanValue(value), true);
  for (const value of [false, 0, 0n, '0', 'f', 'false']) assert.equal(booleanValue(value), false);
  for (const value of [null, '', 'yes', 2, -1, [], {}]) assert.throws(() => booleanValue(value));
});

test('JSON strings and driver objects become independent JSON values; unsafe data rejects', () => {
  const value = { theme: 'dark', nested: [true, null, { n: 2 }] };
  assert.deepEqual(jsonObject(JSON.stringify(value)), value);
  assert.deepEqual(jsonObject(value), value);
  assert.notEqual(jsonObject(value), value);
  assert.equal(jsonValue('null'), null);
  assert.equal(jsonValue('"string"'), 'string');
  for (const invalid of ['{', undefined, 2n, NaN, { x: undefined }, { x: Infinity }, new Date(), new Uint8Array([1])]) assert.throws(() => jsonValue(invalid));
  for (const invalid of ['null', '[]', '1']) assert.throws(() => jsonObject(invalid));
  const cycle: unknown[] = []; cycle.push(cycle);
  assert.throws(() => jsonValue(cycle));
});

test('storage timestamps require a zone and real calendar values, preserve milliseconds', () => {
  assert.equal(utcInstant('2026-10-30T14:00:01.123+02:00'), '2026-10-30T12:00:01.123Z');
  assert.equal(utcInstant(new Date('2026-10-30T12:00:01Z')), '2026-10-30T12:00:01.000Z');
  for (const value of ['2026-02-30T10:00:00Z', '2026-10-30 10:00:00', '2026-10-30', '2026-01-01T25:00:00Z', '2026-01-01T10:00:60Z', '2026-01-01T10:00:00.1234Z', null, 0, new Date(NaN)]) assert.throws(() => utcInstant(value));
  assert.equal(dateOnly('2024-02-29'), '2024-02-29');
  for (const value of ['2025-02-29', '2026-10-30T00:00:00Z', null]) assert.throws(() => dateOnly(value));
});

test('UTC SQL timestamp conversion is explicit and never assumes a local timezone', async () => {
  const { utcSqlInstant } = await import('../../src/storage/conversion.ts');
  assert.equal(utcSqlInstant('2026-10-30 12:00:01.123'), '2026-10-30T12:00:01.123Z');
  assert.equal(utcSqlInstant('2026-10-30 12:00:01+00'), '2026-10-30T12:00:01.000Z');
  assert.equal(utcSqlInstant('2026-10-30 14:00:01+02'), '2026-10-30T12:00:01.000Z');
  assert.throws(() => utcSqlInstant('2026-02-30 12:00:00'));
  assert.throws(() => utcSqlInstant('2026-10-30 12:00:01.123456'));
});
