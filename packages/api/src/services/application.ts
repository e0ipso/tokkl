import type { Repositories, Storage, TransactionContext } from '../storage/contracts.ts';
import type { StorageConfig } from '../storage/config.ts';
import { createStorageAuth, currentCredentialUser, type StorageAuthentication } from '../auth/storageMiddleware.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import { createAccountOperations } from '../domain/accounts.ts';
import { createAccountEntryEffects, createCatalogTimerEffects, createTimerOperations, createTimerPublication } from '../domain/timers.ts';
import { createStorageImports } from './storageImportJson.ts';
import { StorageReportRunner } from './storageReportRunner.ts';
import { TimerHub } from './timerHub.ts';
import { TimerStreams } from './timerStreams.ts';
import { forbidden } from '../lib/errors.ts';
export function createApplicationServices(storage: Storage, config: StorageConfig, limiter: FailureLimiter, streamOptions?: import('./timerStreams.ts').TimerStreamOptions) {
  const timerStreams = new TimerStreams(id => timers.getTimerState(id), streamOptions);
  const hub = new TimerHub();
  const publish = createTimerPublication(async (id, state) => { await Promise.allSettled([timerStreams.publish(id, state), hub.publish(id, state)]); }, id => {
    timerStreams.forgetUser(id);
    hub.forgetUser(id);
  });
  const timers = createTimerOperations(storage, publish);
  const security = { recheckUser: (id: number) => timerStreams.recheck(id) };
  const accounts = createAccountOperations(storage, security);
  const entryEffects = createAccountEntryEffects<Repositories>(publish);
  const auth = createStorageAuth(storage, limiter);
  const reports = new StorageReportRunner(config, storage);
  function protectedStorage(authentication: StorageAuthentication, administrative = false): Storage {
    return { ...storage, transaction: (work, options) => storage.transaction(async (ctx) => {
        if (administrative) await ctx.lockInstanceAdministration();
        if (!await currentCredentialUser(ctx, authentication))
          throw forbidden('Incorrect username and/or password');
        const result = await work(ctx);
        if (administrative) return result;
        // Domain work holds the actor's user guard, or the instance guard for account operations.
        // Recheck after lock acquisition so a credential changed while waiting rolls back the write.
        if (!await currentCredentialUser(ctx, authentication))
          throw forbidden('Incorrect username and/or password');
        return result;
      }, options) };
  }
  return {
    hub, auth, accounts, entryEffects, timerStreams, publish, reports,
    accountsFor: (authentication: StorageAuthentication) => createAccountOperations(protectedStorage(authentication, true), security),
    timersFor: (authentication: StorageAuthentication) => createTimerOperations(protectedStorage(authentication), publish),
    importsFor: (authentication: StorageAuthentication) => createStorageImports(protectedStorage(authentication), publish),
    async entryWrite<T>(authentication: StorageAuthentication, work: (ctx: TransactionContext) => Promise<T>) {
      return protectedStorage(authentication).transaction(work);
    },
    async catalogWrite<T>(authentication: StorageAuthentication, wid: number, work: (ctx: TransactionContext, effects: ReturnType<typeof createCatalogTimerEffects>) => Promise<T>) {
      return protectedStorage(authentication).transaction(async (ctx) => {
        await ctx.lockWorkspaces([wid]);
        const ws = await ctx.workspaces.forMember(authentication.user.id, wid);
        if (!ws)
          throw forbidden('User does not have access to this resource.');
        await ctx.lockUsers([authentication.user.id, ...await ctx.timers.affectedUsers(wid)]);
        return work(ctx, createCatalogTimerEffects(ctx, publish));
      });
    },
    async close() {
      const results = await Promise.allSettled([timerStreams.closeAll(), reports.close()]);
      hub.close();
      if (results.some(result => result.status === 'rejected'))
        throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
