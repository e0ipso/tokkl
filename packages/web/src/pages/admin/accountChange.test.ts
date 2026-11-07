import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminAccount } from '../../api/types.ts';
import { changeField, changeMessage, deleteConfirmError } from './accountChange.ts';

const account: AdminAccount = {
  id: 2,
  email: 'ana@example.com',
  fullname: 'Ana',
  role: 'admin',
  created_at: '2026-10-01T00:00:00+00:00',
  disabled_at: null,
};

test('a change shows its refusal under the control that sent it', () => {
  assert.equal(changeField({ role: 'user' }), 'role');
  assert.equal(changeField({ disabled: true }), 'status');
});

test('the toast names what changed', () => {
  assert.match(changeMessage(account, { role: 'admin' }), /^ana@example\.com is now /);
  assert.equal(changeMessage(account, { disabled: false }), 'Enabled ana@example.com');
  assert.equal(
    changeMessage({ ...account, disabled_at: '2026-10-02T00:00:00+00:00' }, { disabled: true }),
    'Disabled ana@example.com',
  );
});

test('deleting needs the account email, in any case and with spaces trimmed', () => {
  assert.equal(deleteConfirmError(' ANA@example.com ', account.email), false);
  assert.equal(deleteConfirmError('ana@', account.email), "Type the account's email to confirm");
});
