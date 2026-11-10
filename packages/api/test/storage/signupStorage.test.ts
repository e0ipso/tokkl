import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { createTransactionRunner } from '../../src/storage/transactions.ts';
import { createAccountRepositories } from '../../src/storage/repositories/accounts.ts';
import type { AccountToken } from '../../src/domain/model.ts';
import { disposableBackend } from './support/disposableBackend.ts';

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(`${backend}: boolean settings survive restart and malformed JSON settings are ignored`, async () => {
    const fixture = await disposableBackend(backend);
    let connection = await initializeDatabase(fixture.config);
    const at = '2026-10-01T00:00:00.000Z';
    try {
      let runner = createTransactionRunner(connection, db => createAccountRepositories(db, backend));
      for (const value of [true, false]) {
        await runner.transaction(ctx =>
          ctx.settings.write([
            { key: 'signupEnabled', value, updatedAt: at, updatedBy: null },
            { key: 'inviteDays', value: 9, updatedAt: at, updatedBy: null },
          ]),
        );
        assert.equal(
          (
            await connection.db
              .selectFrom('instance_settings')
              .select('value')
              .where('key', '=', 'signup_enabled')
              .executeTakeFirstOrThrow()
          ).value,
          JSON.stringify(value),
        );
        await connection.close();
        connection = await initializeDatabase(fixture.config);
        runner = createTransactionRunner(connection, db => createAccountRepositories(db, backend));
        assert.deepEqual(await runner.readSnapshot(ctx => ctx.settings.read()), {
          signupEnabled: value,
          inviteDays: 9,
        });
      }
      for (const value of ['"true"', 'null', '{}', '[]', 'not json']) {
        await connection.db
          .updateTable('instance_settings')
          .set({ value })
          .where('key', '=', 'signup_enabled')
          .execute();
        assert.deepEqual(await runner.readSnapshot(ctx => ctx.settings.read()), { inviteDays: 9 });
      }
    } finally {
      await connection.close();
      await fixture.cleanup();
    }
  });

  test(`${backend}: token emails normalize once and replacement revokes only unused invites for that email`, async () => {
    const fixture = await disposableBackend(backend);
    const connection = await initializeDatabase(fixture.config);
    const at = '2026-10-01T00:00:00.000Z';
    try {
      const runner = createTransactionRunner(connection, db => createAccountRepositories(db, backend));
      const create = (tokenHash: string, changes: Partial<AccountToken> = {}) =>
        runner.transaction(ctx =>
          ctx.tokens.create({
            tokenHash,
            kind: 'invite',
            role: 'user',
            note: null,
            email: null,
            userId: null,
            createdBy: null,
            createdAt: at,
            expiresAt: '2026-10-08T00:00:00.000Z',
            usedAt: null,
            ...changes,
          }),
        );
      const first = await create('first', { email: '\tSignUP+É@EXAMPLE.TEST\n' });
      assert.equal(first.email, 'signup+É@example.test');
      assert.equal(
        (
          await connection.db
            .selectFrom('account_tokens')
            .select('email')
            .where('id', '=', first.id)
            .executeTakeFirstOrThrow()
        ).email,
        'signup+É@example.test',
      );
      assert.equal(
        (await runner.readSnapshot(ctx => ctx.tokens.findUsable('first', 'invite', at)))!.email,
        first.email,
      );
      assert.equal((await runner.readSnapshot(ctx => ctx.tokens.listPendingInvites(at)))[0]!.email, first.email);
      await create('second', { email: 'SIGNUP+É@example.test' });
      await create('expired', { email: first.email, expiresAt: at });
      const retained = [
        await create('used', { email: first.email, usedAt: at }),
        await create('reset', { kind: 'password_reset', role: null, email: first.email }),
        await create('admin'),
        await create('other', { email: 'other@example.test' }),
        await create('unicode', { email: 'signup+é@example.test' }),
      ];
      await runner.transaction(ctx => ctx.tokens.revokeUnusedSignupInvites('signup+É@example.test'));
      assert.equal(await runner.readSnapshot(ctx => ctx.tokens.findUsable('first', 'invite', at)), undefined);
      assert.equal(await runner.readSnapshot(ctx => ctx.tokens.findUsable('second', 'invite', at)), undefined);
      assert.deepEqual(
        (await connection.db.selectFrom('account_tokens').select('id').orderBy('id').execute()).map(row =>
          Number(row.id),
        ),
        retained.map(token => token.id),
      );
      await runner.transaction(ctx => ctx.tokens.revokeUnusedSignupInvites('signup+É@example.test'));
      const replacement = await create('replacement', { email: first.email });
      assert.equal(
        (await runner.readSnapshot(ctx => ctx.tokens.findUsable('replacement', 'invite', at)))!.id,
        replacement.id,
      );
    } finally {
      await connection.close();
      await fixture.cleanup();
    }
  });
}
