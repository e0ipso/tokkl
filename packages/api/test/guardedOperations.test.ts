import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { openSQLiteDatabase, storageFor } from './fixtures/database.ts';
import { insertAccount } from './fixtures/domain.ts';
import type { Authentication } from '../src/domain/credentials.ts';
import { ApplicationError } from '../src/lib/errors.ts';
import { createApplicationServices } from '../src/services/application.ts';
import { ReportRunner } from '../src/services/reportRunner.ts';

const INLINE = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
const refused = (error: unknown) =>
  error instanceof ApplicationError &&
  error.kind === 'forbidden' &&
  error.message === 'Incorrect username and/or password';

async function signedIn(t: TestContext) {
  const db = await openSQLiteDatabase();
  const storage = storageFor(db);
  const reports = new ReportRunner(INLINE, { readSnapshot: () => Promise.reject(new Error('unused')) });
  const services = createApplicationServices({ storage, reports, sessionDays: 30 });
  t.after(() => services.close());
  const user = await insertAccount(db, {
    email: 'guarded@example.test',
    fullname: 'Guarded',
    timezone: 'UTC',
    passwordHash: 'unused',
    role: 'user',
  });
  const valid: Authentication = { user, credential: { kind: 'api-token', token: user.apiToken }, authMethod: 'basic' };
  const stale: Authentication = { ...valid, credential: { kind: 'api-token', token: `${user.apiToken}-old` } };
  return { services, valid, stale };
}

test('signed-in account operations refuse a stale credential in their read snapshots too', async t => {
  const { services, valid, stale } = await signedIn(t);
  assert.equal(await services.accountsFor(valid).findSessionUser('no-such-session'), undefined);
  await assert.rejects(services.accountsFor(stale).findSessionUser('no-such-session'), refused);
});

test('the signed-in timer read refuses a stale credential', async t => {
  const { services, valid, stale } = await signedIn(t);
  assert.equal((await services.timersFor(valid).getTimerState(valid.user.id)).revision, 0);
  await assert.rejects(services.timersFor(stale).getTimerState(stale.user.id), refused);
});
