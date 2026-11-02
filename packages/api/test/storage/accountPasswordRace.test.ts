import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import type { AccountEntryEffects } from '../../src/domain/accounts.ts';

// Hold real scrypt results to place independent committed writes at either asynchronous boundary.
const realScrypt = crypto.scrypt as unknown as (...args: unknown[]) => void;
let hold: { remaining: number; during: () => Promise<void> } | undefined;
(crypto as { scrypt: unknown }).scrypt = (...args: unknown[]) => {
  const callback = args.pop() as (error: Error | null, key: Buffer) => void;
  const current = hold && --hold.remaining === 0 ? hold : undefined;
  if (current) hold = undefined;
  realScrypt(...args, (error: Error | null, key: Buffer) => {
    if (!current) return callback(error, key);
    current.during().then(() => callback(error, key), failure => callback(failure, key));
  });
};
syncBuiltinESMExports();
const { initializeDatabase } = await import('../../src/storage/migrations.ts');
const { openConnection } = await import('../../src/storage/connections.ts');
const { createTransactionRunner } = await import('../../src/storage/transactions.ts');
const { createAccountRepositories } = await import('../../src/storage/repositories/accounts.ts');
const { createAccountOperations, initializeSetupCode, rotateSetupCode } = await import('../../src/domain/accounts.ts');
const { sha256, verifyPassword } = await import('../../src/auth/crypto.ts');
const { HttpError } = await import('../../src/lib/errors.ts');
const { disposableBackend } = await import('./support/disposableBackend.ts');
const attempt = { async attempt(check: () => Promise<boolean>) { return { refused: false as const, valid: await check() }; } };
const effects: AccountEntryEffects = {
  async reanchorTimezone() { throw new Error('Unexpected timezone effect'); },
  async affectedDeletionUsers() { return []; },
  async beforeDelete(_ctx, _user, sole) { assert.equal(sole.length, 1); },
};
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: password verification and hashing races`, { timeout: 180000 }, async t => {
    const fixture = await disposableBackend(backend);
    let c: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
    let other: Awaited<ReturnType<typeof initializeDatabase>> | undefined;
    try {
      c = await initializeDatabase(fixture.config); other = await openConnection(fixture.config);
      const runner = createTransactionRunner(c, db => createAccountRepositories(db, backend));
      const second = createTransactionRunner(other, db => createAccountRepositories(db, backend));
      const notifications: number[] = [];
      const security = { async recheckUser(userId: number) { notifications.push(userId); } };
      const op = createAccountOperations(runner, security), competing = createAccountOperations(second, security);
      const generated = (submitted: string) => ({ kind: 'generated' as const, submitted });
      let replacement = '';
      await t.test('setup code rotated during first-admin hashing refuses the old code', async () => {
        const started = await initializeSetupCode(runner);
        assert.equal(started.kind, 'generated');
        hold = { remaining: 1, async during() {
          const rotated = await rotateSetupCode(second);
          if (rotated.kind === 'generated') replacement = rotated.code;
        } };
        await assert.rejects(op.createFirstAdmin({ email: 'stale@example.test', password: 'password one' }, generated(started.kind === 'generated' ? started.code : '')),
          e => e instanceof HttpError && e.status === 403 && e.message === 'Invalid setup code. It is printed in the server log on startup.');
        assert.equal(hold, undefined); assert.notEqual(replacement, '');
        assert.equal(await runner.readSnapshot(ctx => ctx.users.count()), 0);
        assert.equal(await runner.readSnapshot(ctx => ctx.setupCodes.read()), sha256(replacement));
      });
      const admin = await op.createFirstAdmin({ email: 'admin@example.test', password: 'password one' }, generated(replacement));
      assert.equal(await runner.readSnapshot(ctx => ctx.setupCodes.read()), undefined);
      for (const [phase, nth] of [['verification', 1], ['hashing', 2]] as const) {
        for (const change of ['reset', 'password-change', 'session-revoke', 'token-rotate', 'logout', 'suspend', 'delete'] as const) {
          await t.test(`${change} committed during ${phase} refuses stale change`, async () => {
            const link = await op.createInvite(admin.id, { role: 'user' }, 30);
            const user = await op.acceptInvite(link.token, { email: `${phase}-${change}@example.test`, password: 'password one' });
            const owner = await op.createSession(user, 'owner', 30), attacker = await op.createSession(user, 'attacker', 30);
            const reset = change === 'reset' ? await op.createPasswordReset(admin.id, user.id) : undefined;
            let committed = false;
            hold = { remaining: nth, async during() {
              if (change === 'reset') await competing.resetPassword(reset!.token, 'owner password');
              if (change === 'password-change') await competing.updateProfile(user, { kind: 'session', token: owner.token }, { password: 'owner password', current_password: 'password one' }, effects, attempt);
              if (change === 'session-revoke') await competing.revokeSessions(admin.id, user.id);
              if (change === 'token-rotate') await competing.rotateApiToken(user, { kind: 'session', token: owner.token });
              if (change === 'logout') await competing.deleteSession(attacker.token);
              if (change === 'suspend') await competing.setAccess(admin.id, user.id, { disabled: true });
              if (change === 'delete') await competing.deleteAccount(admin.id, user.id, user.email, effects);
              committed = true;
            } };
            const credential = change === 'token-rotate' ? { kind: 'api-token' as const, token: user.apiToken } : { kind: 'session' as const, token: attacker.token };
            await assert.rejects(op.updateProfile(user, credential, { password: 'attacker password', current_password: 'password one', fullname: 'Stale write' }, effects, attempt), e => e instanceof HttpError && e.status === 403 && e.message === 'Incorrect username and/or password');
            assert.equal(committed, true); assert.equal(hold, undefined);
            const current = await runner.readSnapshot(ctx => ctx.users.get(user.id));
            if (current) {
              assert.equal(current.fullName, '');
              assert.equal(await verifyPassword('attacker password', current.passwordHash), false);
              if (change === 'reset' || change === 'password-change') assert.equal(await verifyPassword('owner password', current.passwordHash), true);
              else assert.equal(current.passwordHash, user.passwordHash);
            } else assert.equal(change, 'delete');
            if (change === 'password-change') assert.equal((await op.findSessionUser(owner.token))!.id, user.id);
          });
        }
      }
    } finally { hold = undefined; await other?.close(); await c?.close(); await fixture.cleanup(); }
  });
}
