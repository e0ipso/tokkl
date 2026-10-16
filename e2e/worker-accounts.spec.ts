import { EMAIL, expect, test } from './fixtures.ts';

// TT-0210: global setup deletes the worker accounts an earlier run left on a reused data directory,
// in the current worker-<run id>-<n> format and the older worker-<n> one, and no other account.
// It lists every account on the server, so it runs in the instance project.
test('deleting leftover worker accounts removes both address formats and keeps every other account', async ({ data, users }) => {
  const leftovers = ['worker-3@e2e.example', 'worker-0a1b2c3d-0@e2e.example'];
  const others = ['worker@other.example', 'worker-1@other.example', 'jane.doe@example.com'];
  for (const email of [...leftovers, ...others]) await users.create({ email });

  await data.deleteWorkerAccounts();

  const emails = (await data.listUsers()).map((user) => user.email).sort();
  expect(emails).toEqual([EMAIL, ...others].sort());
});
