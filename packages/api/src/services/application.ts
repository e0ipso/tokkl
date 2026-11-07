import type { Repositories, Storage, TransactionContext } from '../storage/contracts.ts';
import type { StorageConfig } from '../storage/config.ts';
import { createStorageAuth, currentCredentialUser, type StorageAuthentication } from '../auth/storageMiddleware.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import { createAccountOperations } from '../domain/accounts.ts';
import { isActiveAdmin } from '../domain/credentials.ts';
import type { TimerState } from '@tokkl/types';
import type { Response } from 'express';
import type { Id } from '../storage/domain.ts';
import { createLocalTimerBus, type TimerBus } from '../domain/timerBus.ts';
import {
  buildTimerState,
  createAccountEntryEffects,
  createCatalogTimerEffects,
  createTimerOperations,
  createTimerPublication,
  type OrderedTimerPublication,
} from '../domain/timers.ts';
import { createStorageImports } from './storageImportJson.ts';
import { StorageReportRunner } from './storageReportRunner.ts';
import { TimerStreams, type TimerStreamOptions } from './timerStreams.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import { forbidden } from '../lib/errors.ts';
import { noWorkspaceAccess } from '../domain/membership.ts';
import { createReadQueries, type ReadQueries } from '../domain/queries.ts';
export interface ApplicationServiceOptions {
  storage: Storage;
  storageConfig: StorageConfig;
  /** Failed password attempts, shared by every path that checks a password. */
  limiter: FailureLimiter;
  streamOptions?: TimerStreamOptions;
  /** Signals timer revisions to other processes. Defaults to the single-process bus. */
  bus?: TimerBus;
  logger?: Logger;
  /** The deployment's session length, used until an admin stores one. */
  sessionDays: number;
}
export function createApplicationServices({
  storage,
  storageConfig: config,
  limiter,
  streamOptions,
  bus = createLocalTimerBus(),
  logger = silentLogger,
  sessionDays,
}: ApplicationServiceOptions) {
  const timerStreams = new TimerStreams(id => timers.getTimerState(id), {
    ...streamOptions,
    // `publish` is defined below; the tick calls this only after construction.
    onBehind: (id, revision) => {
      publish.refresh(id, revision).catch(error => logger.error('Timer refresh failed', { error }));
    },
  });
  const ordered = createTimerPublication(
    async (id, state) => {
      // A failed delivery must not fail the commit that caused it; the next state supersedes it.
      await timerStreams.publish(id, state).catch(error => logger.error('Timer delivery failed', { error }));
    },
    id => timerStreams.forgetUser(id),
    {
      hasStreams: id => timerStreams.hasStreams(id),
      // Read-only on purpose: settling here would commit a new revision and signal it back.
      rebuild: id =>
        storage.readSnapshot(async repositories => {
          const user = await repositories.users.get(id);
          return user ? { state: await buildTimerState(repositories, user), incarnation: user.createdAt } : undefined;
        }),
    },
  );
  const refreshes = new Set<Promise<void>>();
  // Every local commit publishes through here. Remote refreshes skip the send, which stops echo loops.
  const publish: OrderedTimerPublication = Object.assign(
    (id: Id, state: TimerState, incarnation: string) => {
      const delivery = ordered(id, state, incarnation);
      try {
        bus.send({ userId: id, revision: state.revision });
      } catch (error) {
        logger.warn('Timer bus send failed', { error });
      }
      return delivery;
    },
    {
      forgetUser: ordered.forgetUser,
      claim: ordered.claim,
      refresh(id: Id, hintedRevision: number) {
        const refresh = ordered.refresh(id, hintedRevision);
        refreshes.add(refresh);
        void refresh.then(
          () => refreshes.delete(refresh),
          () => refreshes.delete(refresh),
        );
        return refresh;
      },
    },
  );
  const timers = createTimerOperations(storage, publish);
  const security = { recheckUser: (id: number) => timerStreams.recheck(id) };
  const accounts = createAccountOperations(storage, security);
  const entryEffects = createAccountEntryEffects<Repositories>(publish);
  const auth = createStorageAuth(storage, limiter);
  const reports = new StorageReportRunner(config, storage);
  function protectedStorage(authentication: StorageAuthentication, administrative = false): Storage {
    return {
      ...storage,
      transaction: (work, options) =>
        storage.transaction(async ctx => {
          if (administrative) await ctx.lockInstanceAdministration();
          if (!(await currentCredentialUser(ctx, authentication)))
            throw forbidden('Incorrect username and/or password');
          const result = await work(ctx);
          if (administrative) return result;
          // Domain work holds the actor's user guard, or the instance guard for account operations.
          // Recheck after lock acquisition so a credential changed while waiting rolls back the write.
          if (!(await currentCredentialUser(ctx, authentication)))
            throw forbidden('Incorrect username and/or password');
          return result;
        }, options),
    };
  }
  return {
    auth,
    accounts,
    entryEffects,
    timerStreams,
    publish,
    reports,
    /** The claim runs before the stream joins, so it never shares a group with a deleted account's streams. */
    openTimerStream(authentication: StorageAuthentication, res: Response): Promise<void> {
      publish.claim(authentication.user.id, authentication.user.createdAt);
      return timerStreams.open(authentication.user.id, res, auth.credentialCheck(authentication));
    },
    /** Runs read queries in one snapshot, after checking the credential in that same snapshot. */
    readFor<T>(
      authentication: StorageAuthentication,
      work: (queries: ReadQueries) => Promise<T>,
      administrative = false,
    ): Promise<T> {
      return storage.readSnapshot(async repositories => {
        const user = await currentCredentialUser(repositories, authentication);
        if (!user) throw forbidden('Incorrect username and/or password');
        if (administrative && !isActiveAdmin(user)) throw forbidden('Admin access required');
        return work(createReadQueries(repositories, sessionDays));
      });
    },
    accountsFor: (authentication: StorageAuthentication) =>
      createAccountOperations(protectedStorage(authentication, true), security),
    timersFor: (authentication: StorageAuthentication) =>
      createTimerOperations(protectedStorage(authentication), publish),
    importsFor: (authentication: StorageAuthentication) =>
      createStorageImports(protectedStorage(authentication), publish),
    async entryWrite<T>(authentication: StorageAuthentication, work: (ctx: TransactionContext) => Promise<T>) {
      return protectedStorage(authentication).transaction(work);
    },
    async catalogWrite<T>(
      authentication: StorageAuthentication,
      wid: number,
      work: (ctx: TransactionContext, effects: ReturnType<typeof createCatalogTimerEffects>) => Promise<T>,
    ) {
      return protectedStorage(authentication).transaction(async ctx => {
        await ctx.lockWorkspaces([wid]);
        const ws = await ctx.workspaces.forMember(authentication.user.id, wid);
        if (!ws) throw noWorkspaceAccess();
        await ctx.lockUsers([authentication.user.id, ...(await ctx.timers.affectedUsers(wid))]);
        return work(ctx, createCatalogTimerEffects(ctx, publish));
      });
    },
    async close() {
      const results = await Promise.allSettled([timerStreams.closeAll(), reports.close()]);
      // Streams are closed, so no new rebuild starts. Let started ones finish before storage closes.
      await Promise.allSettled([...refreshes]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
