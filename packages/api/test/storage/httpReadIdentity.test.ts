import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Worker } from 'node:worker_threads';
import type { Repositories, Storage } from '../../src/storage/contracts.ts';
import type { Backend } from '../../src/storage/config.ts';
import { createStorage } from '../../src/storage/index.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate, serveInvariant } from './support/invariantHttp.ts';

const password = 'correct horse battery';
const range = { start_date: '2026-10-30', end_date: '2026-10-30' };

function holdAuthentication(t: TestContext, storage: Storage, token: string) {
  const entered = gate(), release = gate(), snapshot = storage.readSnapshot.bind(storage);
  let held = false;
  const mock = t.mock.method(storage, 'readSnapshot', async <T>(work: (repositories: Repositories) => Promise<T>): Promise<T> => {
    const result = await snapshot(work);
    if (!held && result && typeof result === 'object' && 'apiToken' in result && result.apiToken === token) {
      held = true; entered.resolve(); await release.promise;
    }
    return result;
  });
  t.after(() => release.resolve());
  return { entered: entered.promise, release: release.resolve, restore: () => mock.mock.restore() };
}

test('SQLite authenticated reads reject a replacement account with reused IDs', { timeout: 60000 }, async t => {
  const fixture = await disposableBackend('sqlite');
  const storage = createStorage(await initializeDatabase(fixture.config));
  const app = createApp({ storage, config: { ...testConfig(), storage: fixture.config }, setup: { code: null } });
  const server = await serveInvariant(app), services = app.locals.services;
  t.after(async () => { await server.close(); await storage.close(); await fixture.cleanup(); });
  const admin = await services.accounts.createFirstAdmin({ email: 'admin@example.test', password });
  const paths = [
    '/api/v9/me?with_related_data=true',
    '/api/v9/me/time_entries?start_date=2026-10-30&end_date=2026-10-31',
    '/api/v9/workspaces/{wid}/projects',
    '/api/app/bounds',
    '/api/app/trash',
    '/api/app/export.json',
    '/api/app/export.csv',
  ];
  for (const [index, path] of paths.entries()) await t.test(path, async child => {
    const invite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
    const old = await services.accounts.acceptInvite(invite.token, { email: `old${index}@example.test`, password });
    const nextInvite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
    const held = holdAuthentication(child, storage, old.apiToken);
    const pending = server.request('GET', path.replace('{wid}', String(old.defaultWorkspaceId)), undefined, old.apiToken);
    await held.entered;
    held.restore();
    const deletion = await server.request('DELETE', `/api/app/admin/users/${old.id}`, { email: old.email }, admin.apiToken);
    assert.equal(deletion.status, 200); await deletion.json();
    const replacement = await services.accounts.acceptInvite(nextInvite.token, { email: `new${index}@example.test`, password });
    assert.equal(replacement.id, old.id);
    assert.equal(replacement.defaultWorkspaceId, old.defaultWorkspaceId);
    const entry = await server.request('POST', `/api/v9/workspaces/${replacement.defaultWorkspaceId}/time_entries`, {
      start: '2026-10-30T10:00:00Z', stop: '2026-10-30T11:00:00Z', description: 'private replacement entry',
    }, replacement.apiToken);
    assert.equal(entry.status, 200); await entry.json();
    held.release();
    const response = await pending, body = await response.text();
    assert.equal(response.status, 403, body);
    assert.ok(!body.includes('private replacement entry'));
    await services.accounts.deleteAccount(admin.id, replacement.id, replacement.email, services.entryEffects);
  });
});

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as Backend[]) {
  test(`${backend}: deferred reads and reports recheck credentials and admin access`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const storage = createStorage(await initializeDatabase(fixture.config));
    const app = createApp({ storage, config: { ...testConfig(), storage: fixture.config }, setup: { code: null } });
    const server = await serveInvariant(app), services = app.locals.services;
    t.after(async () => { await server.close(); await storage.close(); await fixture.cleanup(); });
    const founder = await services.accounts.createFirstAdmin({ email: 'founder@example.test', password });
    const invite = await services.accounts.createInvite(founder.id, { role: 'admin' }, 30);
    const user = await services.accounts.acceptInvite(invite.token, { email: 'reader@example.test', password });
    let token = user.apiToken;
    for (const path of ['/api/v9/me/workspaces', '/api/app/export.json']) await t.test(`token rotated before ${path}`, async child => {
      const held = holdAuthentication(child, storage, token);
      const pending = server.request('GET', path, undefined, token);
      await held.entered; held.restore();
      const rotated = await server.request('POST', '/api/v9/me/reset_token', undefined, token);
      assert.equal(rotated.status, 200); token = await rotated.json() as string;
      held.release();
      const response = await pending;
      assert.equal(response.status, 403, await response.text());
    });
    await t.test('token rotated while a report waits for its worker', async child => {
      const warm = await server.request('POST', '/api/app/report/entries', range, token);
      assert.equal(warm.status, 200); await warm.json();
      const worker = (services.reports as unknown as { worker: Worker }).worker;
      const post = worker.postMessage.bind(worker), entered = gate();
      let held: unknown;
      const delivery = child.mock.method(worker, 'postMessage', (message: unknown) => { held = message; entered.resolve(); });
      const pending = server.request('POST', '/api/app/report/entries', range, token);
      await entered.promise; delivery.mock.restore();
      child.after(() => { if (held) { post(held); held = undefined; } });
      const rotated = await server.request('POST', '/api/v9/me/reset_token', undefined, token);
      assert.equal(rotated.status, 200); token = await rotated.json() as string;
      post(held); held = undefined;
      const response = await pending;
      assert.equal(response.status, 403, await response.text());
    });
    await t.test('admin demoted after middleware authentication', async child => {
      const held = holdAuthentication(child, storage, token);
      const pending = server.request('GET', '/api/app/admin/users', undefined, token);
      await held.entered; held.restore();
      const demoted = await server.request('PATCH', `/api/app/admin/users/${user.id}`, { role: 'user' }, founder.apiToken);
      assert.equal(demoted.status, 200); await demoted.json();
      held.release();
      const response = await pending;
      assert.equal(response.status, 403, await response.text());
      const current = await server.request('GET', '/api/v9/me/workspaces', undefined, token);
      assert.equal(current.status, 200); await current.json();
    });
  });
}

test('SQLite queued HTTP reports reject a replacement account with reused IDs', { timeout: 30000 }, async t => {
  const fixture = await disposableBackend('sqlite');
  const storage = createStorage(await initializeDatabase(fixture.config));
  const app = createApp({ storage, config: { ...testConfig(), storage: fixture.config }, setup: { code: null } });
  const server = await serveInvariant(app), services = app.locals.services;
  t.after(async () => { await server.close(); await storage.close(); await fixture.cleanup(); });
  const admin = await services.accounts.createFirstAdmin({ email: 'admin@example.test', password });
  for (const [index, report] of ['/api/app/report/entries', '/reports/api/v3/workspace/{wid}/search/time_entries'].entries()) {
    await t.test(report, async child => {
      const invite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
      const old = await services.accounts.acceptInvite(invite.token, { email: `old${index}@example.test`, password });
      const nextInvite = await services.accounts.createInvite(admin.id, { role: 'user' }, 30);
      const path = report.replace('{wid}', String(old.defaultWorkspaceId));
      const warm = await server.request('POST', path, range, old.apiToken);
      assert.equal(warm.status, 200); await warm.json();
      const worker = (services.reports as unknown as { worker: Worker }).worker;
      const post = worker.postMessage.bind(worker), entered = gate();
      let held: unknown;
      const delivery = child.mock.method(worker, 'postMessage', (message: unknown) => { held = message; entered.resolve(); });
      const pending = server.request('POST', path, range, old.apiToken);
      await entered.promise;
      delivery.mock.restore();
      child.after(() => { if (held) { post(held); held = undefined; } });
      const deletion = await server.request('DELETE', `/api/app/admin/users/${old.id}`, { email: old.email }, admin.apiToken);
      assert.equal(deletion.status, 200); await deletion.json();
      const replacement = await services.accounts.acceptInvite(nextInvite.token, { email: `new${index}@example.test`, password });
      assert.equal(replacement.id, old.id);
      assert.equal(replacement.defaultWorkspaceId, old.defaultWorkspaceId);
      const entry = await server.request('POST', `/api/v9/workspaces/${replacement.defaultWorkspaceId}/time_entries`, {
        start: '2026-10-30T10:00:00Z', stop: '2026-10-30T11:00:00Z', description: 'private replacement entry',
      }, replacement.apiToken);
      assert.equal(entry.status, 200); await entry.json();
      post(held); held = undefined;
      const response = await pending, body = await response.text();
      assert.equal(response.status, 403, body);
      assert.ok(!body.includes('private replacement entry'));
      await services.accounts.deleteAccount(admin.id, replacement.id, replacement.email, services.entryEffects);
    });
  }
});
