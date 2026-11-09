import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { storageFor } from './fixtures/database.ts';
import { corruptRecord, rateLimitRowCounts, sessionCount, tokenRows } from './fixtures/physical.ts';
import { addUser, CSRF, sessionCookie, setup, type TestContext } from './helpers.ts';
import { sha256 } from '../src/lib/crypto.ts';
import { systemClock } from '../src/lib/clock.ts';
import { runMaintenance } from '../src/services/maintenance.ts';
import { fixedClock } from './fixtures/clock.ts';

const PAST = '2000-01-01T00:00:00.000Z';
const WINDOW = 15 * 60 * 1000;
const hash = (name: string) => createHash('sha256').update(name).digest('hex');

/** Signs in with a session cookie only. */
const withCookie = (ctx: TestContext, cookie: string) =>
  ctx.request('GET', '/api/v9/me', undefined, { authorization: '', cookie });

test('signing in leaves expired sessions to the maintenance job, and they never authenticate', async () => {
  const admin = await setup();
  const bob = await addUser(admin, { email: 'bob@example.com', role: 'user' });
  const stale = await sessionCookie(bob);
  const live = await sessionCookie(bob);
  await corruptRecord(admin.db, 'sessions', { expires_at: PAST }, { token_hash: sha256(stale.split('=')[1]!) });

  assert.equal((await withCookie(bob, stale)).status, 403, 'an expired session that is still stored signs nothing in');
  await sessionCookie(admin);
  assert.equal(await sessionCount(admin.db, bob.user.id), 2, "a sign-in deletes no other user's session");

  const report = await runMaintenance(storageFor(admin.db), { clock: systemClock });
  assert.equal(report.sessions, 1);
  assert.equal(await sessionCount(admin.db, bob.user.id), 1);
  assert.equal((await withCookie(bob, live)).status, 200, 'a live session stays');
  assert.equal((await withCookie(bob, stale)).status, 403);
});

test('the maintenance job deletes expired sessions a batch at a time until none is left', async () => {
  const ctx = await setup();
  const storage = storageFor(ctx.db);
  await storage.transaction(async tx => {
    for (let i = 0; i < 250; i++)
      await tx.sessions.create({
        tokenHash: hash(`expired ${i}`),
        userId: ctx.user.id,
        createdAt: PAST,
        expiresAt: PAST,
        userAgent: '',
      });
  });
  const batches: number[] = [];
  const counted = {
    transaction: <T>(work: Parameters<typeof storage.transaction<T>>[0]) =>
      storage.transaction(async tx => {
        const deleted = await work(tx);
        if (typeof deleted === 'number' && deleted) batches.push(deleted);
        return deleted;
      }),
  };
  const report = await runMaintenance(counted, { clock: systemClock });
  assert.equal(report.sessions, 250);
  assert.ok(batches.length >= 3 && batches.every(size => size <= 100), `batches: ${batches.join(',')}`);
  assert.equal(await sessionCount(ctx.db), 0);
});

test('stale rate-limit rows change no answer and only the maintenance job deletes them', async () => {
  const ctx = await setup();
  const limits = storageFor(ctx.db).rateLimits;
  const counter = { keyHash: hash('maintenance'), limit: 2 };
  const t0 = Date.parse('2026-11-01T10:00:00.000Z');
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  // One failure, and a reservation never released: both outlive their window and lease.
  const failed = await limits.reserve([counter], at(0), WINDOW, 60_000);
  assert.ok(failed.ok);
  await limits.release(failed.reservations, [counter], true, at(0), WINDOW);
  assert.ok((await limits.reserve([counter], at(0), WINDOW, 60_000)).ok);
  assert.deepEqual(await limits.reserve([counter], at(0), WINDOW, 60_000), { ok: false, reason: 'slots' });

  const later = at(2 * WINDOW);
  const other = { keyHash: hash('other'), limit: 2 };
  const fresh = await limits.reserve([counter, other], later, WINDOW, 60_000);
  assert.ok(fresh.ok, 'an ended window and an expired lease count for nothing');
  await limits.release(fresh.reservations, [counter, other], false, later, WINDOW);
  const rows = await rateLimitRowCounts(ctx.db);
  assert.equal(rows.reservations, 1, 'the expired lease is still stored');

  const report = await runMaintenance(storageFor(ctx.db), { clock: fixedClock(new Date(t0 + 4 * WINDOW)) });
  assert.equal(report.rateLimits, rows.reservations + rows.counters);
  assert.deepEqual(await rateLimitRowCounts(ctx.db), { reservations: 0, counters: 0 });
});

test('the maintenance job deletes used and expired account links and keeps pending ones', async () => {
  const admin = await setup();
  const invite = async () => {
    const response = await admin.json('POST', '/api/app/admin/invites', { role: 'user' });
    assert.equal(response.status, 200);
    return { id: response.body.id as number, token: (response.body.url as string).replace(/^\/invite\//, '') };
  };
  const used = await invite();
  const accepted = await admin.request(
    'POST',
    `/api/app/invites/${used.token}`,
    { email: 'new@example.com', password: 'invited person 1', timezone: 'UTC' },
    { authorization: '', ...CSRF },
  );
  assert.equal(accepted.status, 200);
  const expired = await invite();
  await corruptRecord(admin.db, 'account_tokens', { expires_at: PAST }, { id: expired.id });
  const pending = await invite();
  const reset = await admin.json('POST', `/api/app/admin/users/${admin.user.id}/password-reset`);
  assert.equal(reset.status, 200);
  assert.equal((await tokenRows(admin.db)).length, 4);

  const report = await runMaintenance(storageFor(admin.db), { clock: systemClock });
  assert.equal(report.accountTokens, 2);
  assert.deepEqual(
    (await tokenRows(admin.db)).map(row => row.kind),
    ['invite', 'password_reset'],
  );
  const list = await admin.json('GET', '/api/app/admin/invites');
  assert.deepEqual(
    list.body.map((row: { id: number }) => row.id),
    [pending.id],
  );
  const check = await admin.request('GET', `/api/app/invites/${pending.token}`, undefined, { authorization: '' });
  assert.equal(check.status, 200, 'a pending invite still works');
});
