import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { openSQLiteDatabase, storageFor } from './fixtures/database.ts';
import { insertAccount } from './fixtures/domain.ts';
import type { Authentication } from '../src/domain/credentials.ts';
import { parseStartTimer } from '../src/commands/timers.ts';
import { ApplicationError } from '../src/lib/errors.ts';
import { createApplicationServices, DEFAULT_SERVICE_SETTINGS } from '../src/services/application.ts';
import { createLocalTimerBus } from '../src/storage/timerBus.ts';
import { systemClock } from '../src/lib/clock.ts';
import { createReportRunner } from '../src/reportRunners.ts';

const INLINE = { backend: 'sqlite' as const, filename: ':memory:', busyTimeoutMs: 5000 };
const refused = (error: unknown) =>
  error instanceof ApplicationError &&
  error.kind === 'forbidden' &&
  error.message === 'Incorrect username and/or password';

async function signedIn(t: TestContext) {
  const db = await openSQLiteDatabase();
  const storage = storageFor(db);
  const reports = createReportRunner(INLINE, { readSnapshot: () => Promise.reject(new Error('unused')) });
  const services = createApplicationServices({
    storage,
    reports,
    bus: createLocalTimerBus(),
    clock: systemClock,
    settings: DEFAULT_SERVICE_SETTINGS,
    sessionDays: 30,
  });
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
  return { services, storage, user, valid, stale };
}

test('signed-in account operations refuse a stale credential', async t => {
  const { services, stale } = await signedIn(t);
  await assert.rejects(services.accountsFor(stale).rotateApiToken(), refused);
});

test('the signed-in account operations act for the signed-in user', async t => {
  const { services, storage, user, valid } = await signedIn(t);
  const accounts = services.accountsFor(valid);
  await assert.rejects(
    accounts.revokeSessions(user.id),
    error => error instanceof ApplicationError && error.message === 'Admin access required',
  );
  const token = await accounts.rotateApiToken();
  assert.equal((await storage.readSnapshot(repositories => repositories.users.get(user.id)))?.apiToken, token);
});

test('the signed-in preference saves act for the signed-in user', async t => {
  const { services, storage, user, valid } = await signedIn(t);
  await services.preferencesFor(valid).savePreferences({ theme: 'dark' });
  const stored = await storage.readSnapshot(repositories => repositories.users.get(user.id));
  assert.equal(stored?.preferences.theme, 'dark');
});

test('the services the routers share hold no account operations without a credential check', async t => {
  const { services } = await signedIn(t);
  for (const [name, value] of Object.entries(services))
    assert.ok(typeof value !== 'object' || value === null || !('createSession' in value), name);
});

test('the signed-in timer read refuses a stale credential', async t => {
  const { services, valid, stale } = await signedIn(t);
  assert.equal((await services.timersFor(valid).getTimerState()).revision, 0);
  await assert.rejects(services.timersFor(stale).getTimerState(), refused);
});

test('the signed-in timer operations act for the signed-in user', async t => {
  const { services, valid } = await signedIn(t);
  const timers = services.timersFor(valid);
  await timers.startTimer(parseStartTimer({ revision: 0, description: 'Mine' }));
  assert.equal((await timers.getTimerState()).running_entry?.description, 'Mine');
  assert.equal((await timers.pauseTimer(undefined)).pause?.paused, true);
});
