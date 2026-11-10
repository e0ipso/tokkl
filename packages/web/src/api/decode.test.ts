import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecodeError, list, object } from './decode.ts';
import { t } from '../i18n/messages.ts';

test('a reply of the expected kind comes back as it is', () => {
  const reply = { id: 1, extra: true };
  assert.equal(object(reply), reply);
  assert.deepEqual(list([1, 2]), [1, 2]);
});

test('a reply of the wrong kind fails with the generic message', () => {
  const failures = [() => object(null), () => object([1]), () => object('x'), () => list({}), () => list(null)];
  for (const fail of failures) {
    assert.throws(fail, (error: unknown) => error instanceof DecodeError && error.message === t('api.unreadableReply'));
  }
});
