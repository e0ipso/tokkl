import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trashLimitNotice } from './trashLimit.ts';

test('the trash says it lists only the newest entries once the total passes the limit', () => {
  assert.equal(
    trashLimitNotice({ total: 1500, limit: 1000 }),
    'Showing the 1000 most recently deleted of 1500 entries.',
  );
});

test('a whole trash list, or one whose total is unknown, gets no notice', () => {
  assert.equal(trashLimitNotice({ total: 1000, limit: 1000 }), null);
  assert.equal(trashLimitNotice({ total: 3, limit: 1000 }), null);
  assert.equal(trashLimitNotice(undefined), null);
});
