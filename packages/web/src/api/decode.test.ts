import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DecodeError,
  array,
  boolean,
  instant,
  integer,
  knownNames,
  nullable,
  number,
  object,
  oneOf,
  optional,
  string,
} from './decode.ts';

interface Item {
  id: number;
  name: string;
  done: boolean;
  note: string | null;
  kind: 'a' | 'b';
  extra?: number;
}

const item = object<Item>({
  id: number,
  name: string,
  done: boolean,
  note: nullable(string),
  kind: oneOf('a', 'b'),
  extra: optional(number),
});

test('a value that fits comes back with the fields the decoders do not list', () => {
  const reply = { id: 1, name: 'One', done: false, note: null, kind: 'a', server_only: 'kept' };
  assert.deepEqual(item(reply), reply);
});

test('an optional field may be missing but must fit when present', () => {
  assert.equal(item({ id: 1, name: 'One', done: true, note: 'x', kind: 'b' }).extra, undefined);
  assert.throws(() => item({ id: 1, name: 'One', done: true, note: 'x', kind: 'b', extra: '2' }), {
    name: 'DecodeError',
    message: 'The server sent an unreadable reply: reply.extra is not a number.',
  });
});

test('the error names the path to the first field that does not fit', () => {
  const list = array(item);
  const good = { id: 1, name: 'One', done: false, note: null, kind: 'a' };
  assert.throws(
    () => list([good, { ...good, note: 5 }]),
    (error: unknown) => error instanceof DecodeError && error.at === 'reply[1].note',
  );
  assert.throws(() => list([{ ...good, kind: 'c' }]), { message: /reply\[0\]\.kind is not one of a, b/ });
  assert.throws(() => list({}), { message: /reply is not a list/ });
});

test('null, lists and scalars are not objects', () => {
  for (const value of [null, [], 'text', 3]) assert.throws(() => item(value), { message: /reply is not an object/ });
});

test('knownNames keeps the names it knows, drops the rest, and still wants a list of strings', () => {
  const names = knownNames({ a: true, b: true });
  assert.deepEqual(names(['b', 'later', 'a']), ['b', 'a']);
  assert.deepEqual(names([]), []);
  // Names inherited from Object.prototype are not known names.
  assert.deepEqual(names(['toString', 'constructor']), []);
  assert.throws(() => names('a'), { message: /reply is not a list/ });
  assert.throws(
    () => names(['a', 3]),
    (error: unknown) => error instanceof DecodeError && error.at === 'reply[1]',
  );
});

test('nullable accepts null and checks anything else', () => {
  const maybe = nullable(number);
  assert.equal(maybe(null), null);
  assert.equal(maybe(4), 4);
  assert.throws(() => maybe(undefined), DecodeError);
});

test('numbers must be finite and integers safe', () => {
  assert.equal(number(1.5), 1.5);
  for (const value of [Number.NaN, Infinity, -Infinity, '1']) {
    assert.throws(() => number(value), { message: 'The server sent an unreadable reply: reply is not a number.' });
  }
  assert.equal(integer(-1), -1);
  assert.equal(integer(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [1.5, 2 ** 53, Number.NaN, '7']) {
    assert.throws(() => integer(value), {
      message: 'The server sent an unreadable reply: reply is not a whole number.',
    });
  }
});

test('an instant is an RFC 3339 date and time with a zone', () => {
  for (const value of ['2026-10-27T10:00:00Z', '2026-10-27T10:00:00.123Z', '2026-10-27T12:00:00+02:00']) {
    assert.equal(instant(value), value);
  }
  for (const value of ['2026-10-27', '2026-10-27T10:00:00', '2026-02-30T10:00:00Z', '2026-10-27 10:00:00Z', 0, null]) {
    assert.throws(() => instant(value, 'reply.start'), {
      message: 'The server sent an unreadable reply: reply.start is not a date and time with a time zone.',
    });
  }
});
