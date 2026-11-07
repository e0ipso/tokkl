import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecodeError, array, boolean, nullable, number, object, oneOf, optional, string } from './decode.ts';

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

test('nullable accepts null and checks anything else', () => {
  const maybe = nullable(number);
  assert.equal(maybe(null), null);
  assert.equal(maybe(4), 4);
  assert.throws(() => maybe(undefined), DecodeError);
});
