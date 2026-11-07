import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AccountRunner } from '../../src/domain/accountGuards.ts';
import type { AccountEntryEffects } from '../../src/domain/accounts.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';
import { errorReply } from '../../src/http/errors.ts';
import { generateApiToken, hashPassword, sha256 } from '../../src/lib/crypto.ts';
import { createApplicationServices } from '../../src/services/application.ts';
import { ReportRunner } from '../../src/services/reportRunner.ts';
import { openConnection } from '../../src/storage/connections.ts';
import type { Repositories, Storage } from '../../src/storage/contracts.ts';
import { createStorage } from '../../src/storage/index.ts';
import { initializeDatabase } from '../../src/storage/migrations.ts';
import { disposableBackend } from './support/disposableBackend.ts';
import { gate } from './support/invariantHttp.ts';

const effects: AccountEntryEffects<Repositories> = {
  async reanchorTimezone() {
    throw new Error('Unexpected timezone change');
  },
  async affectedDeletionUsers() {
    return [];
  },
  async beforeDelete() {}, // These accounts have no entries or timer state.
};
const security = { async recheckUser() {} };

/** Runs each transaction's work, then holds the commit until `release`. */
function holdingCommit(storage: Storage) {
  const entered = gate(),
    release = gate();
  const runner: AccountRunner<Repositories> = {
    readSnapshot: work => storage.readSnapshot(work),
    transaction: work =>
      storage.transaction(async ctx => {
        const value = await work(ctx);
        entered.resolve();
        await release.promise;
        return value;
      }),
  };
  return { runner, entered, release };
}

/** Settles `pending` once the deletion committed, and checks it was still waiting until then. */
async function afterDeletion<T>(
  pending: Promise<T>,
  hold: ReturnType<typeof holdingCommit>,
  deletion: Promise<void>,
): Promise<PromiseSettledResult<T>> {
  let settled = false;
  const outcome = Promise.allSettled([pending]).then(([result]) => {
    settled = true;
    return result!;
  });
  await delay(300);
  assert.equal(settled, false, 'the write waits for the deletion');
  hold.release.resolve();
  await deletion;
  return outcome;
}

function refusal(result: PromiseSettledResult<unknown>) {
  assert.equal(result.status, 'rejected');
  const { status, body } = errorReply(result.reason);
  return { status, body };
}

for (const backend of ['sqlite', 'postgres', 'mysql', 'mariadb'] as const) {
  test(
    `${backend}: sign-ins and preference saves refuse an account deleted while they wait`,
    { timeout: 240000 },
    async t => {
      const fixture = await disposableBackend(backend);
      const storage = createStorage(await initializeDatabase(fixture.config));
      const competing = createStorage(await openConnection(fixture.config));
      const services = createApplicationServices({
        storage,
        reports: new ReportRunner(fixture.config, storage),
        sessionDays: 30,
      });
      t.after(async () => {
        await services.close();
        await competing.close();
        await storage.close();
        await fixture.cleanup();
      });
      const accounts = createAccountOperations(storage, security);
      const passwordHash = await hashPassword('password one');
      const account = (name: string, role: 'admin' | 'user' = 'user') =>
        storage.transaction(ctx =>
          ctx.users.createAccount({
            email: `${name}@example.test`,
            fullName: name,
            timezone: 'UTC',
            passwordHash,
            apiToken: generateApiToken(),
            role,
            preferences: {},
          }),
        );
      const admin = await account('admin', 'admin');
      /** Deletes `id` on the other connection and holds the commit until the hold is released. */
      const deleting = async (id: number, email: string) => {
        const hold = holdingCommit(competing);
        const deletion = createAccountOperations(hold.runner, security).deleteAccount(admin.id, id, email, effects);
        await hold.entered.promise;
        return { hold, deletion };
      };

      await t.test('a login refuses with the sign-in message', async () => {
        const member = await account('login');
        const { hold, deletion } = await deleting(member.id, member.email);
        const result = await afterDeletion(accounts.createSession(member, 'agent', 30), hold, deletion);
        assert.deepEqual(refusal(result), { status: 403, body: 'Incorrect email or password' });
      });

      await t.test('a logout ends without an error and leaves no session', async () => {
        const member = await account('logout');
        const { token } = await accounts.createSession(member, 'agent', 30);
        const { hold, deletion } = await deleting(member.id, member.email);
        const result = await afterDeletion(accounts.deleteSession(token), hold, deletion);
        assert.equal(result.status, 'fulfilled');
        assert.equal(await storage.readSnapshot(ctx => ctx.sessions.find(sha256(token))), undefined);
      });

      await t.test('a preference save refuses the credential', async () => {
        const member = await account('preferences');
        const authentication = {
          user: member,
          credential: { kind: 'api-token' as const, token: member.apiToken },
          authMethod: 'basic' as const,
        };
        const { hold, deletion } = await deleting(member.id, member.email);
        const save = services.preferencesFor(authentication).savePreferences(member.id, { theme: 'dark' });
        const result = await afterDeletion(save, hold, deletion);
        assert.deepEqual(refusal(result), { status: 403, body: 'Incorrect username and/or password' });
      });
    },
  );
}
