import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { openConnection } from '../../src/storage/connections.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';
import { HttpError } from '../../src/lib/errors.ts';
import { sha256, verifyPassword } from '../../src/auth/crypto.ts';
import { getPreferences, serializeAccount, serializeInvite, serializeUser, serializeWorkspace, readNewAccount } from '../../src/domain/accountValues.ts';
import { jsonObject } from '../../src/storage/conversion.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: account operations`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    let connection: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
    let other: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
    try {
      connection = await initializeDatabase(fixture.config);
      other = await openConnection(fixture.config);
      const runner = createTransactionRunner(connection, db => createAccountRepositories(db, backend));
      const second = createTransactionRunner(other, db => createAccountRepositories(db, backend));
      const invalidations: number[] = [];
      const security = { async recheckUser(userId: number) { invalidations.push(userId); } };
      const operations = createAccountOperations(runner, security);
      const competitor = createAccountOperations(second, security);
      await t.test('setup race creates one admin, private workspace and owner membership', async () => {
        const result = await Promise.allSettled([operations, competitor].map((op, i) => op.createFirstAdmin({ email: `first${i}@example.test`, fullname: 'First', timezone: 'UTC', password: 'password one' })));
        assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
        await runner.readSnapshot(async ctx => {
          assert.equal(await ctx.users.count(), 1);
          const [user] = await ctx.users.list();
          assert.equal(user!.role, 'admin');
          assert.equal(await ctx.workspaces.getRole(user!.id, user!.defaultWorkspaceId), 'owner');
          assert.equal((await ctx.workspaces.listForUser(user!.id)).length, 1);
        });
      });

      const readUser = (id: number) => runner.readSnapshot(ctx => ctx.users.get(id));
      const admin = (await runner.readSnapshot(ctx => ctx.users.list()))[0]!;
      const add = async (email: string, role: 'admin' | 'user' = 'user') => {
        const invite = await operations.createInvite(admin.id, { role }, 30);
        return operations.acceptInvite(invite.token, { email, password: 'password one', timezone: 'Europe/Madrid' });
      };
      const bob = await add('bob@example.test');
      const carol = await add('carol@example.test');
      const error = (status: number, message: string) => (e: unknown) => e instanceof HttpError && e.status === status && e.message === message;
      const calls: string[] = [];
      const effects = {
        async reanchorTimezone(_ctx: unknown, _id: number, oldZone: string, newZone: string) { calls.push(`${oldZone}->${newZone}`); },
        async affectedDeletionUsers() { return [admin.id]; },
        async beforeDelete(ctx: unknown) { assert.ok(ctx); calls.push('delete'); },
      };
      const attempt = { async attempt(check: () => Promise<boolean>) { return check(); }, retryAfterSeconds() { return 17; } };
      await t.test('membership uses workspace roles, hides missing workspaces and validates defaults atomically', async () => {
        await operations.addWorkspaceMember(admin.id, admin.defaultWorkspaceId, bob.id, 'member');
        await assert.rejects(operations.addWorkspaceMember(bob.id, admin.defaultWorkspaceId, carol.id, 'member'), error(403, 'User does not have access to this resource.'));
        await runner.readSnapshot(async ctx => {
          const list = await ctx.workspaces.listMembers(admin.defaultWorkspaceId);
          assert.deepEqual(list.map(m => [m.userId, m.role]), [[admin.id, 'owner'], [bob.id, 'member']]);
          assert.equal(await ctx.workspaces.forMember(carol.id, admin.defaultWorkspaceId), undefined);
          assert.equal(await ctx.workspaces.forMember(carol.id, 999999), undefined);
          assert.equal(serializeWorkspace((await ctx.workspaces.get(admin.defaultWorkspaceId))!, await ctx.workspaces.getRole(bob.id, admin.defaultWorkspaceId)).admin, false);
        });
        await assert.rejects(operations.updateProfile(bob, { kind: 'api-token', token: bob.apiToken }, { default_workspace_id: carol.defaultWorkspaceId, fullname: 'Rejected' }, effects), error(400, 'Invalid default_workspace_id'));
        assert.equal((await readUser(bob.id))!.fullName, '');
        assert.equal((await operations.updateProfile(bob, { kind: 'api-token', token: bob.apiToken }, { default_workspace_id: admin.defaultWorkspaceId }, effects)).defaultWorkspaceId, admin.defaultWorkspaceId);
      });
      await t.test('workspace changes preserve member permissions, rounding validation and currency normalization', async () => {
        const updated = await operations.updateWorkspace(bob.id, admin.defaultWorkspaceId, { name: ' Shared ', default_currency: 'usd', default_hourly_rate: 12.5, rounding: -1, rounding_minutes: 6 });
        assert.equal(updated.name, 'Shared'); assert.equal(updated.defaultCurrency, 'USD'); assert.equal(updated.defaultHourlyRate, 12.5);
        await assert.rejects(operations.updateWorkspace(carol.id, admin.defaultWorkspaceId, { name: 'Taken' }), error(403, 'User does not have access to this resource.'));
        await assert.rejects(operations.updateWorkspace(bob.id, admin.defaultWorkspaceId, { rounding: 2 }), error(400, 'Invalid rounding'));
      });
      await t.test('ASCII-only email lookup, duplicate invite rollback and normalized public values', async () => {
        assert.equal((await runner.readSnapshot(ctx => ctx.users.findByEmail('BOB@example.test')))!.id, bob.id);
        const upper = await add('Ä@example.test');
        const lower = await add('ä@example.test');
        assert.notEqual(upper.id, lower.id);
        const invite = await operations.createInvite(admin.id, { role: 'user', note: ' Note ' }, 30);
        await assert.rejects(operations.acceptInvite(invite.token, { email: 'BOB@example.test', password: 'password one' }), error(400, 'An account with this email already exists'));
        const user = await operations.acceptInvite(invite.token, { email: 'trailing@example.test', password: 'password one' });
        assert.equal(typeof user.id, 'number'); assert.equal(user.disabledAt, null);
        assert.equal(user.createdAt.endsWith('.000Z') || /\.\d{3}Z$/.test(user.createdAt), true);
        assert.equal(serializeUser(user, { includeToken: false }).api_token, undefined);
        assert.deepEqual(Object.keys(serializeAccount(user)), ['id', 'email', 'fullname', 'role', 'created_at', 'disabled_at']);
        assert.equal(Object.hasOwn(serializeInvite(invite.invite), 'tokenHash'), false);
        await runner.readSnapshot(async ctx => {
          assert.equal(await ctx.tokens.findUsable(sha256(invite.token), 'invite', new Date().toISOString()), undefined);
          assert.equal((await ctx.workspaces.get(user.defaultWorkspaceId))!.defaultCurrency, 'EUR');
        });
      });
      await t.test('one invite has one winner across independent connections', async () => {
        const link = await operations.createInvite(admin.id, { role: 'user' }, 30);
        const outcomes = await Promise.allSettled([operations, competitor].map((op, i) => op.acceptInvite(link.token, { email: `race${i}@example.test`, password: 'password one' })));
        assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
        const failure = outcomes.find(r => r.status === 'rejected');
        assert.ok(failure?.status === 'rejected' && error(404, 'This invite link is not valid. Ask your admin for a new one.')(failure.reason));
      });
      await t.test('unknown preferences retain all finite JSON numbers, known validation and size errors stay exact', async () => {
        const prefs = await operations.savePreferences(bob.id, { extension: { huge: 1e100, smallest: Number.MIN_VALUE }, theme: 'dark' });
        assert.deepEqual(prefs.extension, { huge: 1e100, smallest: Number.MIN_VALUE });
        assert.equal(prefs.theme, 'dark');
        assert.equal((await operations.savePreferences(bob.id, { overflow: Infinity })).overflow, null);
        assert.equal(getPreferences((await readUser(bob.id))!).theme, 'dark');
        assert.deepEqual(jsonObject('{"extension":1e100}'), { extension: 1e100 });
        await assert.rejects(operations.savePreferences(bob.id, { theme: 'invalid' }), error(400, 'Invalid theme: expected one of system, light, dark'));
        await assert.rejects(operations.savePreferences(bob.id, { large: 'x'.repeat(65536) }), error(400, 'Preferences are too large'));
      });
      await t.test('settings use validated deployment defaults, portable upserts and fixed existing sessions', async () => {
        const session = await operations.createSession(bob, 'x'.repeat(300), 12);
        assert.equal(Date.parse(session.expires.toISOString()) - Date.now() > 11 * 86400000, true);
        const settings = await operations.updateSettings(admin.id, { session_days: 2, invite_days: 4, time_resolution_minutes: 10 }, 12);
        assert.deepEqual(settings, { sessionDays: 2, inviteDays: 4, timeResolutionMinutes: 10 });
        await operations.updateSettings(admin.id, { invite_days: 3 }, 12);
        const later = await operations.createSession(bob, 'browser', 12);
        assert.equal(Date.parse(later.expires.toISOString()) - Date.now() < 3 * 86400000, true);
        await runner.readSnapshot(async ctx => {
          assert.equal((await ctx.sessions.find(sha256(session.token)))!.userAgent.length, 255);
          assert.equal((await ctx.sessions.find(sha256(session.token)))!.expiresAt, session.expires.toISOString());
        });
        await assert.rejects(operations.updateSettings(bob.id, { invite_days: 2 }, 12), error(403, 'Admin access required'));
        await assert.rejects(operations.updateSettings(admin.id, { invite_days: 0 }, 12), error(400, 'Invalid invite_days: expected an integer from 1 to 90'));
      });
      await t.test('token expiry boundary, invite revocation, reset replacement and single consumption', async () => {
        const expired = await runner.transaction(ctx => ctx.tokens.create({ tokenHash: sha256('expired'), kind: 'invite', role: 'user', note: null, userId: null, createdBy: admin.id, createdAt: '2000-01-01T00:00:00.000Z', expiresAt: '2000-01-02T00:00:00.000Z', usedAt: null }));
        assert.equal(await runner.transaction(ctx => ctx.tokens.consume(expired.id, '2000-01-02T00:00:00.000Z')), false);
        await assert.rejects(operations.acceptInvite('expired', { email: 'expired@example.test', password: 'password one' }), error(404, 'This invite link is not valid. Ask your admin for a new one.'));
        const revoked = await operations.createInvite(admin.id, { role: 'user' }, 30);
        await operations.revokeInvite(admin.id, revoked.invite.id);
        await assert.rejects(operations.acceptInvite(revoked.token, {}), error(404, 'This invite link is not valid. Ask your admin for a new one.'));
        const old = await operations.createPasswordReset(admin.id, carol.id);
        const link = await operations.createPasswordReset(admin.id, carol.id);
        assert.equal(Date.parse(link.reset.expiresAt) - Date.parse(link.reset.createdAt), 86400000);
        await assert.rejects(operations.resetPassword(old.token, 'password two'), error(404, 'This password reset link is not valid. Ask your admin for a new one.'));
        const session = await operations.createSession(carol, 'browser', 30);
        const outcomes = await Promise.allSettled([operations, competitor].map(op => op.resetPassword(link.token, 'password two')));
        assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
        const updated = (await readUser(carol.id))!;
        assert.notEqual(updated.apiToken, carol.apiToken);
        assert.ok(await verifyPassword('password two', updated.passwordHash));
        assert.equal(await operations.findSessionUser(session.token), undefined);
        await assert.rejects(operations.createSession(carol, 'stale password', 30), error(403, 'Incorrect email or password'));
      });
      await t.test('last active admin race revalidates under the instance guard', async () => {
        const secondAdmin = await add('second-admin@example.test', 'admin');
        // Each actor remains active until its own protected mutation.
        const outcomes = await Promise.allSettled([operations.setAccess(secondAdmin.id, secondAdmin.id, { disabled: true }), competitor.setAccess(admin.id, admin.id, { role: 'user' })]);
        assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
        const rejected = outcomes.find(r => r.status === 'rejected');
        assert.ok(rejected?.status === 'rejected' && error(400, 'At least one active admin must remain')(rejected.reason));
        // Restore original actor and remove the extra admin without weakening the invariant.
        const remaining = (await runner.readSnapshot(ctx => ctx.users.list())).find(u => u.role === 'admin' && u.disabledAt === null)!;
        await operations.setAccess(remaining.id, admin.id, { role: 'admin', disabled: false });
        await operations.setAccess(admin.id, secondAdmin.id, { role: 'user' });
      });
      await t.test('password change retains its session, ends others and rejects stale credentials', async () => {
        const seen = (await readUser(bob.id))!;
        const owner = await operations.createSession(seen, 'owner', 30), lost = await operations.createSession(seen, 'lost', 30);
        const changed = await operations.updateProfile(seen, { kind: 'session', token: owner.token }, { password: 'password three', current_password: 'password one' }, effects, attempt);
        assert.notEqual(changed.apiToken, seen.apiToken);
        assert.equal((await operations.findSessionUser(owner.token))!.id, bob.id);
        assert.equal(await operations.findSessionUser(lost.token), undefined);
        await assert.rejects(operations.updateProfile(seen, { kind: 'session', token: lost.token }, { password: 'password four', current_password: 'password one' }, effects, attempt), error(403, 'Incorrect username and/or password'));
        await assert.rejects(operations.updateProfile(changed, { kind: 'session', token: owner.token }, { password: 'password four', current_password: 'wrong password' }, effects, attempt), error(400, 'Current password is not valid'));
        await assert.rejects(operations.updateProfile(changed, { kind: 'session', token: owner.token }, { password: 'password four' }, effects, { async attempt() { return null; }, retryAfterSeconds() { return 17; } }), e => error(429, 'Too many failed attempts, try again later')(e) && (e as HttpError).headers['Retry-After'] === '17');
      });
      await t.test('reset, revocation, rotation and deletion during password verification prevent writes', async () => {
        for (const kind of ['reset', 'session-revoke', 'token-rotate', 'delete', 'suspend'] as const) {
          const user = await add(`during-${kind}@example.test`);
          const session = await operations.createSession(user, 'browser', 30);
          const reset = kind === 'reset' ? await operations.createPasswordReset(admin.id, user.id) : undefined;
          const credential = kind === 'token-rotate' ? { kind: 'api-token' as const, token: user.apiToken } : { kind: 'session' as const, token: session.token };
          const during = { async attempt(check: () => Promise<boolean>) {
            const valid = await check();
            if (kind === 'reset') await competitor.resetPassword(reset!.token, 'password reset');
            if (kind === 'session-revoke') await competitor.revokeSessions(admin.id, user.id);
            if (kind === 'token-rotate') await competitor.rotateApiToken(user, { kind: 'session', token: session.token });
            if (kind === 'delete') await competitor.deleteAccount(admin.id, user.id, user.email, effects);
            if (kind === 'suspend') await competitor.setAccess(admin.id, user.id, { disabled: true });
            return valid;
          }, retryAfterSeconds() { return 17; } };
          await assert.rejects(operations.updateProfile(user, credential, { password: 'attacker password', current_password: 'password one', fullname: 'Must not write' }, effects, during), error(403, 'Incorrect username and/or password'));
          const stored = await readUser(user.id);
          if (stored) { assert.equal(stored.fullName, ''); assert.equal(await verifyPassword('attacker password', stored.passwordHash), false); }
        }
      });
      await t.test('timezone integration uses the protected current zone and rolls back on callback failure', async () => {
        const user = (await readUser(bob.id))!, session = await operations.createSession(user, 'browser', 30);
        const during = { async attempt(check: () => Promise<boolean>) {
          const valid = await check();
          await competitor.updateProfile(user, { kind: 'session', token: session.token }, { timezone: 'Asia/Tokyo' }, effects);
          return valid;
        }, retryAfterSeconds() { return 17; } };
        await operations.updateProfile(user, { kind: 'session', token: session.token }, { password: 'password five', current_password: 'password three', timezone: 'America/New_York' }, effects, during);
        assert.equal(calls.at(-1), 'Asia/Tokyo->America/New_York');
        const current = (await readUser(user.id))!;
        await assert.rejects(operations.updateProfile(current, { kind: 'session', token: session.token }, { timezone: 'UTC' }, { ...effects, async reanchorTimezone() { throw new Error('integration failed'); } }), /integration failed/);
        assert.equal((await readUser(user.id))!.timezone, 'America/New_York');
      });
      await t.test('suspension revokes sessions, reset links and API authorization remain inactive', async () => {
        const user = await add('suspend@example.test'), session = await operations.createSession(user, 'browser', 30);
        const reset = await operations.createPasswordReset(admin.id, user.id);
        const disabled = await operations.setAccess(admin.id, user.id, { disabled: true });
        assert.ok(disabled.disabledAt);
        assert.equal(await operations.findSessionUser(session.token), undefined);
        await assert.rejects(operations.resetPassword(reset.token, 'password two'), error(404, 'This password reset link is not valid. Ask your admin for a new one.'));
        await assert.rejects(operations.createPasswordReset(admin.id, user.id), error(400, 'Enable the account before resetting its password'));
        await assert.rejects(operations.rotateApiToken(user, { kind: 'api-token', token: user.apiToken }), error(403, 'Incorrect username and/or password'));
      });
      await t.test('security integration publishes once after commit and never after refused credentials', async () => {
        const current = (await readUser(admin.id))!;
        const before = invalidations.length;
        await operations.rotateApiToken(current, { kind: 'api-token', token: current.apiToken });
        assert.deepEqual(invalidations.slice(before), [admin.id]);
        await assert.rejects(operations.rotateApiToken(current, { kind: 'api-token', token: current.apiToken }), error(403, 'Incorrect username and/or password'));
        assert.equal(invalidations.length, before + 1);
      });
      await t.test('session expiry preserves equality, deletes only earlier sessions and logout is idempotent', async () => {
        const at = '2026-10-30T12:00:00.000Z';
        await runner.transaction(async ctx => {
          for (const [token, expires] of [['equal', at], ['past', '2026-10-30T11:59:59.999Z'], ['future', '2026-10-30T12:00:00.001Z']]) {
            await ctx.sessions.create({ tokenHash: sha256(token!), userId: admin.id, createdAt: '2026-10-29T00:00:00.000Z', expiresAt: expires!, userAgent: '' });
          }
        });
        t.mock.timers.enable({ apis: ['Date'], now: Date.parse(at) });
        try {
          assert.equal((await operations.findSessionUser('equal'))!.id, admin.id);
          assert.equal(await operations.findSessionUser('past'), undefined);
          assert.equal((await operations.findSessionUser('future'))!.id, admin.id);
          assert.equal(await runner.transaction(ctx => ctx.sessions.deleteExpired(at)), 1);
          await operations.deleteSession('equal'); await operations.deleteSession('equal');
          assert.equal(await operations.findSessionUser('equal'), undefined);
        } finally { t.mock.timers.reset(); }
      });
      await t.test('last admin deletion, missing users and invalid setup timezone keep established errors', async () => {
        await assert.rejects(operations.deleteAccount(admin.id, admin.id, admin.email, effects), error(400, 'At least one active admin must remain'));
        await assert.rejects(operations.deleteAccount(admin.id, 999999, 'missing@example.test', effects), error(404, 'User not found'));
        for (const timezone of [null, 123, ' ', '+02:00']) assert.throws(() => readNewAccount({ email: 'new@example.test', password: 'password one', timezone }), error(400, 'Invalid timezone'));
      });
      await t.test('deletion preserves shared workspaces and audit rows, removes sole workspaces and credentials', async () => {
        const target = await add('delete@example.test', 'admin');
        const member = await add('shared-member@example.test');
        await operations.addWorkspaceMember(target.id, target.defaultWorkspaceId, member.id, 'member');
        const privateWs = await runner.transaction(async ctx => {
          const ws = await ctx.workspaces.create('Sole workspace');
          await ctx.workspaces.addMember({ workspaceId: ws.id, userId: target.id, role: 'owner' }); return ws;
        });
        // Physical fixtures cover ownership cascades without depending on catalog/entry implementations.
        for (const [id, userId, workspaceId] of [[10001, target.id, privateWs.id], [10002, target.id, target.defaultWorkspaceId], [10003, member.id, target.defaultWorkspaceId]]) {
          await connection!.db.insertInto('time_entries').values({ id: id!, user_id: userId!, workspace_id: workspaceId!,
            project_id: null, task_id: null, start: '2026-01-01T00:00:00.000Z', stop: '2026-01-01T01:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }).execute();
        }
        const pending = await operations.createInvite(target.id, { role: 'user' }, 30);
        const used = await operations.createInvite(target.id, { role: 'user' }, 30);
        const accepted = await operations.acceptInvite(used.token, { email: 'survivor@example.test', password: 'password one' });
        await operations.updateSettings(target.id, { invite_days: 8 }, 30);
        const session = await operations.createSession(target, 'browser', 30);
        await assert.rejects(operations.deleteAccount(admin.id, target.id, 'wrong', effects), error(400, "Enter the account's email to confirm the deletion"));
        await assert.rejects(operations.deleteAccount(target.id, target.id, target.email, effects), error(400, 'You cannot delete your own account'));
        await operations.deleteAccount(admin.id, target.id, ' DELETE@example.test ', effects);
        assert.equal(await operations.findSessionUser(session.token), undefined);
        await runner.readSnapshot(async ctx => {
          assert.equal(await ctx.users.get(target.id), undefined);
          assert.equal(await ctx.users.findByApiToken(target.apiToken), undefined);
          assert.equal(await ctx.workspaces.get(privateWs.id), undefined);
          assert.ok(await ctx.workspaces.get(target.defaultWorkspaceId));
          assert.deepEqual((await ctx.workspaces.listMembers(target.defaultWorkspaceId)).map(m => m.userId), [member.id]);
          assert.ok(await ctx.users.get(accepted.id));
          assert.equal(await ctx.tokens.findUsable(sha256(pending.token), 'invite', new Date().toISOString()), undefined);
        });
        assert.deepEqual((await connection!.db.selectFrom('time_entries').select('id').where('id', '>=', 10001).orderBy('id').execute()).map(row => Number(row.id)), [10003]);
        const audit = await connection!.db.selectFrom('account_tokens').select(['created_by', 'user_id']).where('id', '=', used.invite.id).executeTakeFirstOrThrow();
        assert.equal(audit.created_by, null); assert.equal(Number(audit.user_id), accepted.id);
        assert.equal((await connection!.db.selectFrom('instance_settings').select('updated_by').where('key', '=', 'invite_days').executeTakeFirstOrThrow()).updated_by, null);
      });
    } finally { await other?.close(); await connection?.close(); await fixture.cleanup(); }
  });
}
