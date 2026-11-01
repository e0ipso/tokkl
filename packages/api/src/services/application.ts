import type { Repositories, Storage, TransactionContext } from '../storage/contracts.ts';
import type { StorageConfig } from '../storage/config.ts';
import { createStorageAuth, currentCredentialUser, type StorageAuthentication } from '../auth/storageMiddleware.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import { createAccountOperations, isActiveAdmin } from '../domain/accounts.ts';
import type { TimerState } from '@tokkl/types';
import type { Id } from '../storage/domain.ts';
import { createLocalTimerBus, type TimerBus } from '../domain/timerBus.ts';
import { buildTimerState, createAccountEntryEffects, createCatalogTimerEffects, createTimerOperations, createTimerPublication, type OrderedTimerPublication } from '../domain/timers.ts';
import { createStorageImports } from './storageImportJson.ts';
import { StorageReportRunner } from './storageReportRunner.ts';
import { TimerHub } from './timerHub.ts';
import { TimerStreams } from './timerStreams.ts';
import { forbidden } from '../lib/errors.ts';
export function createApplicationServices(storage: Storage, config: StorageConfig, limiter: FailureLimiter, streamOptions?: import('./timerStreams.ts').TimerStreamOptions, bus: TimerBus = createLocalTimerBus()) {
  const timerStreams = new TimerStreams(id => timers.getTimerState(id), streamOptions);
  const hub = new TimerHub();
  const ordered = createTimerPublication(async (id, state) => { await Promise.allSettled([timerStreams.publish(id, state), hub.publish(id, state)]); }, id => {
    timerStreams.forgetUser(id);
    hub.forgetUser(id);
  }, {
    hasStreams: id => timerStreams.hasStreams(id),
    // Read-only on purpose: settling here would commit a new revision and signal it back.
    rebuild: id => storage.readSnapshot(async repositories => {
      const user = await repositories.users.get(id);
      return user ? buildTimerState(repositories, user) : undefined;
    }),
  });
  const refreshes = new Set<Promise<void>>();
  // Every local commit publishes through here. Remote refreshes skip the send, which stops echo loops.
  const publish: OrderedTimerPublication = Object.assign((id: Id, state: TimerState) => {
    const delivery = ordered(id, state);
    try { bus.send({ userId: id, revision: state.revision }); }
    catch { console.error('Timer bus send failed'); }
    return delivery;
  }, {
    forgetUser: ordered.forgetUser,
    refresh(id: Id, hintedRevision: number) {
      const refresh = ordered.refresh(id, hintedRevision);
      refreshes.add(refresh);
      void refresh.then(() => refreshes.delete(refresh), () => refreshes.delete(refresh));
      return refresh;
    },
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
    readFor<T>(authentication: StorageAuthentication, work: (repositories: Repositories) => Promise<T>, administrative = false): Promise<T> {
      return storage.readSnapshot(async repositories => {
        const user = await currentCredentialUser(repositories, authentication);
        if (!user) throw forbidden('Incorrect username and/or password');
        if (administrative && !isActiveAdmin(user)) throw forbidden('Admin access required');
        return work(repositories);
      });
    },
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
      // Streams are closed, so no new rebuild starts. Let started ones finish before storage closes.
      await Promise.allSettled([...refreshes]);
      hub.close();
      if (results.some(result => result.status === 'rejected'))
        throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
