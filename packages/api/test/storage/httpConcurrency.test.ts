import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimerState } from '@tokkl/types';
import type { Storage } from '../../src/storage/contracts.ts';
import type { User } from '../../src/storage/domain.ts';
import { createStorage } from '../../src/storage/index.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../src/storage/physical.ts';
import { initializeDatabase, migrations, verifyCurrent } from '../../src/storage/migrations.ts';
import { createApp } from '../../src/app.ts';
import { sha256 } from '../../src/auth/crypto.ts';
import { testConfig } from '../helpers.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate, serveInvariant } from './support/invariantHttp.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: overlapping HTTP invariants on independent storage connections`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    const config = fixture.config.backend === 'sqlite' ? fixture.config : { ...fixture.config, poolMax: 1 };
    const c = await initializeDatabase(config), other = await openConnection<PhysicalDatabase>(config);
    const stores = [createStorage(c), createStorage(other)];
    let barrier: { remaining: number; entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | undefined;
    const wrapped = (storage: Storage): Storage => ({ ...storage, async transaction(work, options) {
      const current = barrier;
      if (current && current.remaining > 0) {
        if (--current.remaining === 0) current.entered.resolve();
        await current.release.promise;
      }
      return storage.transaction(work, options);
    } });
    const apps = stores.map(storage => createApp({ storage: wrapped(storage), config: { ...testConfig(), storage: config }, setup: { code: 'TEST-CODE' } }));
    const servers = await Promise.all(apps.map(serveInvariant));
    t.after(async () => { barrier?.release.resolve(); await Promise.all(servers.map(s => s.close())); await Promise.all(stores.map(s => s.close())); await fixture.cleanup(); });
    const request = (i: number, method: string, path: string, body?: unknown, token?: string) => servers[i]!.request(method, path, body, token);
    async function overlap(first: () => Promise<Response>, second: () => Promise<Response>) {
      barrier = { remaining: 2, entered: gate(), release: gate() };
      const current = barrier;
      const work = Promise.all([first(), second()]);
      const deadline = setTimeout(() => current.entered.resolve(), 5000);
      try { await current.entered.promise; assert.equal(current.remaining, 0, 'both real HTTP requests reached independent write transactions'); }
      finally { clearTimeout(deadline); current.release.resolve(); barrier = undefined; }
      return work;
    }
    const json = async (r: Response) => ({ status: r.status, body: await r.json() as unknown });
    const status = (rs: Response[]) => rs.map(r => r.status).sort((a,b) => a-b);
    const account = async (email: string, role: 'admin' | 'user' = 'user'): Promise<User> => {
      const invite = await apps[0]!.locals.services.accounts.createInvite(admin.id, { role }, 30);
      return apps[0]!.locals.services.accounts.acceptInvite(invite.token, { email, password: 'correct horse battery' });
    };
    let admin!: User;
    await t.test('first-admin setup has exactly one winner and one private workspace', async () => {
      const results = await overlap(...[0,1].map(i => () => request(i, 'POST', '/api/app/setup', {
        email: `setup${i}@example.test`, password: 'correct horse battery', setup_code: 'TEST-CODE',
      })) as [() => Promise<Response>, () => Promise<Response>]);
      assert.deepEqual(status(results), [200,403]);
      assert.deepEqual(await Promise.all(results.map(json)), results.map(r => r.status === 200
        ? { status: 200, body: { ok: true } } : { status: 403, body: 'Setup has already been completed' }));
      const users = await stores[0]!.users.list(); assert.equal(users.length, 1); admin = users[0]!;
      assert.equal(admin.role, 'admin');
      assert.equal((await c.db.selectFrom('workspaces').selectAll().execute()).length, 1);
      assert.equal((await c.db.selectFrom('workspace_users').selectAll().execute()).length, 1);
    });
    await t.test('absent timer state yields one Pomodoro and an exact current-state conflict', async () => {
      const user = await account('timer@example.test');
      assert.equal(await stores[0]!.timers.getRevision(user.id), undefined);
      const rs = await overlap(() => request(0, 'POST', '/api/app/pomodoro', {}, user.apiToken), () => request(1, 'POST', '/api/app/pomodoro', {}, user.apiToken));
      assert.deepEqual(status(rs), [200,409]);
      const states = await Promise.all(rs.map(r => r.json() as Promise<TimerState>));
      const normalize = ({ server_time: _time, ...state }: TimerState) => state;
      assert.deepEqual(normalize(states[0]!), normalize(states[1]!));
      assert.equal(states[0]!.revision, 1); assert.equal(states[0]!.pomodoro!.entry_id, states[0]!.running_entry!.id);
      const rows = await c.db.selectFrom('time_entries').selectAll().where('user_id', '=', user.id).where('stop', 'is', null).execute();
      assert.equal(rows.length, 1);
      assert.equal((await stores[1]!.timers.getRevision(user.id))!.revision, 1);
      const starts = await overlap(() => request(0, 'POST', `/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`, { start: new Date().toISOString(), description: 'one' }, user.apiToken),
        () => request(1, 'POST', `/api/v9/workspaces/${user.defaultWorkspaceId}/time_entries`, { start: new Date().toISOString(), description: 'two' }, user.apiToken));
      assert.deepEqual(status(starts), [200,200]);
      const ids = await Promise.all(starts.map(async r => (await r.json() as { id: number }).id));
      const live = await c.db.selectFrom('time_entries').selectAll().where('user_id', '=', user.id).where('stop', 'is', null).execute();
      assert.equal(live.length, 1); assert.ok(ids.includes(Number(live[0]!.id)));
      assert.equal((await stores[1]!.timers.getRevision(user.id))!.revision, 3);
    });
    await t.test('ASCII name collisions preserve nullable client/project scope', async () => {
      const base = `/api/v9/workspaces/${admin.defaultWorkspaceId}`;
      for (const [path, names, error] of [
        ['/clients', ['Client','CLIENT'], 'Name has already been taken'],
        ['/projects', ['Project','PROJECT'], 'Name has already been taken'],
        ['/tags', ['Tag','TAG'], 'A tag with the same name already exists'],
      ] as const) {
        const rs = await overlap(() => request(0, 'POST', base + path, { name: names[0] }, admin.apiToken), () => request(1, 'POST', base + path, { name: names[1] }, admin.apiToken));
        assert.deepEqual(status(rs), [200,400]); assert.equal(await rs.find(r => r.status === 400)!.json(), error);
        await rs.find(r => r.status === 200)!.json();
      }
      const client = (await stores[0]!.clients.list(admin.defaultWorkspaceId))[0]!;
      assert.equal((await request(0, 'POST', base + '/projects', { name: 'Project', client_id: client.id }, admin.apiToken)).status, 200);
      const projects = await stores[0]!.projects.list(admin.defaultWorkspaceId);
      assert.equal(projects.length, 2); assert.deepEqual(projects.map(p => p.clientId).sort(), [null,client.id].sort());
      const path = base + `/projects/${projects[0]!.id}/tasks`;
      const rs = await overlap(() => request(0,'POST',path,{name:'Task'},admin.apiToken), () => request(1,'POST',path,{name:'TASK'},admin.apiToken));
      assert.deepEqual(status(rs),[200,400]); assert.equal(await rs.find(r => r.status === 400)!.json(),'Name has already been taken');
      assert.equal((await stores[0]!.tasks.list(admin.defaultWorkspaceId)).length,1);
      assert.equal((await c.db.selectFrom('clients').selectAll().execute()).length,1);
      assert.equal((await c.db.selectFrom('tags').selectAll().execute()).length,1);
    });
    await t.test('invite/reset tokens consume exactly once and reset revokes old credentials', async () => {
      const invite = await apps[0]!.locals.services.accounts.createInvite(admin.id, { role: 'user' },30);
      const accepted = await overlap(() => request(0,'POST',`/api/app/invites/${invite.token}`,{email:'accepted0@example.test',password:'correct horse battery'}),
        () => request(1,'POST',`/api/app/invites/${invite.token}`,{email:'accepted1@example.test',password:'correct horse battery'}));
      assert.deepEqual(status(accepted),[200,404]);
      assert.equal(await accepted.find(r=>r.status===404)!.json(),'This invite link is not valid. Ask your admin for a new one.');
      assert.deepEqual(await accepted.find(r=>r.status===200)!.json(),{ok:true});
      const consumed = await c.db.selectFrom('account_tokens').selectAll().where('token_hash','=',sha256(invite.token)).executeTakeFirstOrThrow();
      assert.ok(consumed.used_at); assert.ok(consumed.user_id);
      const user = (await stores[0]!.users.get(Number(consumed.user_id)))!;
      const reset = await apps[0]!.locals.services.accounts.createPasswordReset(admin.id,user.id);
      const rs = await overlap(() => request(0,'POST',`/api/app/password-resets/${reset.token}`,{password:'replacement password'}),
        () => request(1,'POST',`/api/app/password-resets/${reset.token}`,{password:'replacement password'}));
      assert.deepEqual(status(rs),[200,404]);
      assert.equal(await rs.find(r=>r.status===404)!.json(),'This password reset link is not valid. Ask your admin for a new one.');
      assert.deepEqual(await rs.find(r=>r.status===200)!.json(),{ok:true});
      assert.ok((await c.db.selectFrom('account_tokens').selectAll().where('token_hash','=',sha256(reset.token)).executeTakeFirstOrThrow()).used_at);
      assert.equal((await c.db.selectFrom('sessions').selectAll().where('user_id','=',user.id).execute()).length,0);
      assert.equal((await request(0,'GET','/api/v9/me',undefined,user.apiToken)).status,403);
      assert.notEqual((await stores[0]!.users.get(user.id))!.apiToken,user.apiToken);
    });
    await t.test('last admin demotion and competing deletions retain one active admin', async () => {
      const peer = await account('peer@example.test','admin');
      const rs = await overlap(() => request(0,'PATCH',`/api/app/admin/users/${admin.id}`,{role:'user'},admin.apiToken),
        () => request(1,'PATCH',`/api/app/admin/users/${peer.id}`,{role:'user'},peer.apiToken));
      assert.deepEqual(status(rs),[200,400]); assert.equal(await rs.find(r=>r.status===400)!.json(),'At least one active admin must remain');
      assert.equal(await stores[0]!.users.countActiveAdmins(),1);
      const survivor = (await stores[0]!.users.list()).find(u=>u.role==='admin')!;
      const promoted = survivor.id === admin.id ? peer : admin;
      assert.equal((await request(0,'PATCH',`/api/app/admin/users/${promoted.id}`,{role:'admin'},survivor.apiToken)).status,200);
      const deleted = await overlap(() => request(0,'DELETE',`/api/app/admin/users/${peer.id}`,{email:peer.email},admin.apiToken),
        () => request(1,'DELETE',`/api/app/admin/users/${admin.id}`,{email:admin.email},peer.apiToken));
      assert.deepEqual(status(deleted),[200,403]); assert.equal(await deleted.find(r=>r.status===403)!.json(),'Incorrect username and/or password');
      assert.deepEqual(await deleted.find(r=>r.status===200)!.json(),{ok:true});
      assert.equal(await stores[0]!.users.countActiveAdmins(),1);
      const remaining = (await stores[0]!.users.list()).find(u=>u.role==='admin')!;
      const gone = remaining.id === admin.id ? peer : admin;
      assert.equal(await stores[0]!.users.get(gone.id),undefined);
      assert.equal((await c.db.selectFrom('workspace_users').selectAll().where('user_id','=',gone.id).execute()).length,0);
      admin = remaining;
    });
    await t.test('overlapping token rotation has one winner and refuses the stale write', async () => {
      const rs = await overlap(() => request(0,'POST','/api/v9/me/reset_token',undefined,admin.apiToken), () => request(1,'POST','/api/v9/me/reset_token',undefined,admin.apiToken));
      assert.deepEqual(status(rs),[200,403]); assert.equal(await rs.find(r=>r.status===403)!.json(),'Incorrect username and/or password');
      const token = await rs.find(r=>r.status===200)!.json() as string;
      assert.equal((await stores[0]!.users.get(admin.id))!.apiToken,token);
      assert.equal((await request(1,'GET','/api/v9/me',undefined,admin.apiToken)).status,403);
      assert.equal((await request(1,'GET','/api/v9/me',undefined,token)).status,200);
    });
    await verifyCurrent(c);
    const ledger = await c.db.selectFrom('storage_migrations').select(['version','state']).orderBy('version').execute();
    assert.deepEqual(ledger.map(r=>({version:Number(r.version),state:r.state})),migrations(backend).map(m=>({version:m.version,state:'complete'})));
  });
}
