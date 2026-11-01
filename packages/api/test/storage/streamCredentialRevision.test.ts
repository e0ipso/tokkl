import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credentialCheck, type StorageAuthentication } from '../../src/auth/storageMiddleware.ts';
import { sha256 } from '../../src/auth/crypto.ts';
import { createStorage } from '../../src/storage/index.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import type { User } from '../../src/storage/domain.ts';
import { disposableBackend } from './support/disposableBackend.ts';

const day = 24 * 60 * 60 * 1000;
for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: stream credential check reads the timer revision without extra statements`, { timeout: 240000 }, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    try {
      let statements = 0;
      const storage = createStorage({ ...connection, db: connection.db.withPlugin({
        transformQuery(args) { statements++; return args.node; },
        async transformResult(args) { return args.result; },
      }) });
      const counted = async <T>(work: () => Promise<T>) => {
        const before = statements;
        const value = await work();
        return { value, statements: statements - before };
      };
      // Snapshot setup and teardown statements differ per engine; the check's own reads must not.
      const { statements: snapshot } = await counted(() => storage.readSnapshot(async () => undefined));
      let n = 0;
      const add = () => storage.transaction(ctx => ctx.users.createAccount({
        email: `stream-${++n}@example.test`, fullName: `Stream ${n}`, passwordHash: `hash-${n}`, apiToken: `token-${n}`,
        timezone: 'UTC', role: 'user', preferences: {},
      }));
      const session = async (owner: User, expiresAt = new Date(Date.now() + day).toISOString()) => {
        const token = `session-${owner.id}-${++n}`;
        await storage.transaction(ctx => ctx.sessions.create({ tokenHash: sha256(token), userId: owner.id, createdAt: new Date().toISOString(), expiresAt, userAgent: 'stream' }));
        return token;
      };
      const authFor = (owner: User, credential: StorageAuthentication['credential']): StorageAuthentication =>
        ({ user: owner, credential, authMethod: credential.kind === 'session' ? 'session' : 'basic' });
      const check = (auth: StorageAuthentication) => counted(credentialCheck(storage, auth));

      const user = await add(), other = await add();
      const accepted = { 'api-token': authFor(user, { kind: 'api-token', token: user.apiToken }), password: authFor(user, { kind: 'password' }), session: authFor(user, { kind: 'session', token: await session(user) }) };
      const expectedStatements = { 'api-token': 1, password: 1, session: 2 };
      for (const [kind, auth] of Object.entries(accepted) as Array<[keyof typeof accepted, StorageAuthentication]>) {
        const result = await check(auth);
        assert.deepEqual(result.value, { valid: true, revision: 0 }, `${kind} without timer state`);
        assert.equal(result.statements - snapshot, expectedStatements[kind], `${kind} statements`);
      }

      await storage.transaction(ctx => ctx.timers.saveRevision({ userId: user.id, revision: 41, fingerprint: 'stream-fingerprint', discardedPomodoro: null }));
      for (const [kind, auth] of Object.entries(accepted) as Array<[keyof typeof accepted, StorageAuthentication]>) {
        const result = await check(auth);
        assert.deepEqual(result.value, { valid: true, revision: 41 }, `${kind} with timer state`);
        assert.equal(result.statements - snapshot, expectedStatements[kind], `${kind} statements with timer state`);
      }
      assert.deepEqual(await storage.readSnapshot(ctx => ctx.users.getWithTimerRevision(user.id)), { user: await storage.users.get(user.id), timerRevision: 41 });
      assert.deepEqual(await storage.readSnapshot(ctx => ctx.users.getWithTimerRevision(other.id)), { user: await storage.users.get(other.id), timerRevision: 0 });
      assert.equal(await storage.readSnapshot(ctx => ctx.users.getWithTimerRevision(other.id + 1000)), undefined);

      const refused: Record<string, StorageAuthentication> = {
        'wrong api token': authFor(user, { kind: 'api-token', token: other.apiToken }),
        'stale password hash': authFor({ ...user, passwordHash: 'previous-hash' }, { kind: 'password' }),
        'stale api token for password': authFor({ ...user, apiToken: 'previous-token' }, { kind: 'password' }),
        'session owned by another user': authFor(user, { kind: 'session', token: await session(other) }),
        'unknown session': authFor(user, { kind: 'session', token: 'missing-session' }),
        'expired session': authFor(user, { kind: 'session', token: await session(user, new Date(Date.now() - 1000).toISOString()) }),
        'missing user': authFor({ ...user, id: other.id + 1000 }, { kind: 'password' }),
      };
      for (const [name, auth] of Object.entries(refused)) assert.deepEqual((await check(auth)).value, { valid: false }, name);
      await storage.transaction(ctx => ctx.users.setAccess(user.id, 'user', new Date().toISOString()));
      for (const [kind, auth] of Object.entries(accepted)) assert.deepEqual((await check(auth)).value, { valid: false }, `disabled ${kind}`);

      const failing = credentialCheck(storage, authFor(other, { kind: 'password' }));
      await connection.close();
      assert.deepEqual(await failing(), { valid: false }, 'storage failure fails closed');
    } finally { await connection.close(); await fixture.cleanup(); }
  });
}
