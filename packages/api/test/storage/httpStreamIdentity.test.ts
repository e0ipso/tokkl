import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimerState } from '@tokkl/types';
import type { StorageAuthentication } from '../../src/auth/storageMiddleware.ts';
import { createStorage } from '../../src/storage/index.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate, readTimerStream, serveInvariant } from './support/invariantHttp.ts';

for (const delayed of [false, true]) test(`SQLite reused account identity cannot inherit a deleted account SSE snapshot${delayed ? ' with an old publication pending' : ''}`, { timeout: 20000 }, async t => {
  const fixture = await disposableBackend('sqlite');
  const storage = createStorage(await initializeDatabase(fixture.config));
  const app = createApp({ storage, config: { ...testConfig(), storage: fixture.config }, setup: { code: null } });
  const server = await serveInvariant(app), services = app.locals.services;
  const release = gate(), entered = gate(), releasePublication = gate(), publicationEntered = gate();
  let holdPublicationCheck = false;
  const credentialCheck = services.auth.credentialCheck.bind(services.auth);
  t.mock.method(services.auth, 'credentialCheck', (authentication: StorageAuthentication) => {
    const check = credentialCheck(authentication);
    return async () => {
      if (holdPublicationCheck) {
        holdPublicationCheck = false; publicationEntered.resolve(); await releasePublication.promise;
      }
      return check();
    };
  });
  t.after(async () => { release.resolve(); releasePublication.resolve(); await server.close(); await storage.close(); await fixture.cleanup(); });
  const admin = await services.accounts.createFirstAdmin({ email: 'admin@example.test', password: 'correct horse battery' });
  const invite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
  const old = await services.accounts.acceptInvite(invite.token, { email: 'old@example.test', password: 'correct horse battery' });
  const nextInvite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
  const oldStream = await readTimerStream(await server.request('GET', '/api/app/timer/events', undefined, old.apiToken));
  t.after(() => oldStream.close());
  await oldStream.until(() => oldStream.states.length === 1);
  const started = await server.request('POST', `/api/v9/workspaces/${old.defaultWorkspaceId}/time_entries`, {
    start: new Date().toISOString(), description: 'private deleted account timer',
  }, old.apiToken);
  assert.equal(started.status, 200); await started.json();
  await oldStream.until(() => oldStream.states.some(s => s.revision > 0));
  const privateState = oldStream.states.at(-1)!;
  let pendingEdit: Promise<Response> | undefined;
  if (delayed) {
    holdPublicationCheck = true;
    const id = privateState.running_entry!.id;
    pendingEdit = server.request('PUT', `/api/v9/workspaces/${old.defaultWorkspaceId}/time_entries/${id}`, { description: 'private delayed old publication' }, old.apiToken);
    await publicationEntered.promise;
    assert.equal((await storage.entries.get(old.id, id))!.description, 'private delayed old publication', 'the held publication follows a real committed HTTP edit');
  }
  const recheck = services.timerStreams.recheck.bind(services.timerStreams);
  t.mock.method(services.timerStreams, 'recheck', async (id: number) => {
    if (id === old.id) { entered.resolve(); await release.promise; }
    await recheck(id);
  });
  const deletion = server.request('DELETE', `/api/app/admin/users/${old.id}`, { email: old.email }, admin.apiToken);
  await entered.promise;
  assert.equal(await storage.users.get(old.id), undefined, 'deletion has committed before the gated credential recheck');
  const accepted = await server.request('POST', `/api/app/invites/${nextInvite.token}`, { email: 'new@example.test', password: 'correct horse battery' });
  assert.equal(accepted.status, 200); await accepted.json();
  const replacement = (await storage.users.list()).find(u => u.email === 'new@example.test')!;
  assert.equal(replacement.id, old.id, 'SQLite really reused the highest deleted account ID');
  const fresh = await readTimerStream(await server.request('GET', '/api/app/timer/events', undefined, replacement.apiToken));
  t.after(() => fresh.close());
  await fresh.until(() => fresh.states.length === 1);
  // Release before asserting so failure cleanup cannot leave the protected delete request pending.
  release.resolve(); releasePublication.resolve();
  assert.equal((await deletion).status, 200);
  if (pendingEdit) assert.equal((await pendingEdit).status, 200);
  await oldStream.until(oldStream.ended);
  const current = await (await server.request('GET', '/api/app/timer', undefined, replacement.apiToken)).json() as TimerState;
  assert.equal(current.revision, 0); assert.equal(current.running_entry, null);
  assert.equal(fresh.states[0]!.revision, 0);
  assert.equal(fresh.states[0]!.running_entry, null);
  assert.ok(fresh.states.every(state => state.revision === 0 && state.running_entry === null));
  assert.ok(!JSON.stringify(fresh.states).includes(privateState.running_entry!.description));
  assert.ok(!JSON.stringify(fresh.states).includes('private delayed old publication'));
});
