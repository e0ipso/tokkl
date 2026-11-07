/**
 * The application services the HTTP layer calls: domain operations bound to storage, the signed-in
 * credential checks around them, timer delivery and the report runner. Framework-free; `app.ts`
 * composes them with the HTTP adapters.
 */
import type { Repositories, Storage, TransactionContext } from '../storage/contracts.ts';
import type { StorageConfig } from '../storage/config.ts';
import { createLocalTimerBus, type TimerBus } from '../storage/timerBus.ts';
import { createAccountOperations, createPreferenceOperations } from '../domain/accounts.ts';
import { authenticatedUser, isActiveAdmin, type Authentication } from '../domain/credentials.ts';
import { noWorkspaceAccess } from '../domain/membership.ts';
import { createReadQueries, type ReadQueries } from '../domain/queries.ts';
import { createAccountEntryEffects, createCatalogTimerEffects } from '../domain/timerEffects.ts';
import type { CatalogTimerEffects } from '../domain/catalogs.ts';
import { createTimerOperations } from '../domain/timers.ts';
import { forbidden } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import { createStorageImports } from './importJson.ts';
import { StorageReportRunner } from './reportRunner.ts';
import { credentialCheck } from './streamCredentials.ts';
import { createTimerDelivery } from './timerDelivery.ts';
import { presentTimerOperations } from './timerReplies.ts';
import type { EventStreamResponse, TimerStreamOptions } from './timerStreams.ts';

export interface ApplicationServiceOptions {
  storage: Storage;
  storageConfig: StorageConfig;
  streamOptions?: TimerStreamOptions;
  /** Signals timer revisions to other processes. Defaults to the single-process bus. */
  bus?: TimerBus;
  logger?: Logger;
  /** The deployment's session length, used until an admin stores one. */
  sessionDays: number;
}

const refused = () => forbidden('Incorrect username and/or password');

/**
 * `storage` whose transactions refuse a credential that no longer holds. Account operations
 * (`administrative`) check once under the instance guard. Other work checks before and again after
 * it ran, because it holds the actor's user guard only once the domain took it: a credential
 * changed while the write waited rolls the write back.
 */
function guardedStorage(storage: Storage, authentication: Authentication, administrative = false): Storage {
  return {
    ...storage,
    transaction: (work, options) =>
      storage.transaction(async ctx => {
        if (administrative) await ctx.lockInstanceAdministration();
        if (!(await authenticatedUser(ctx, authentication))) throw refused();
        const result = await work(ctx);
        if (administrative) return result;
        if (!(await authenticatedUser(ctx, authentication))) throw refused();
        return result;
      }, options),
  };
}

export function createApplicationServices({
  storage,
  storageConfig,
  streamOptions,
  bus = createLocalTimerBus(),
  logger = silentLogger,
  sessionDays,
}: ApplicationServiceOptions) {
  const { timerStreams, publish, settled } = createTimerDelivery({ storage, bus, logger, streamOptions });
  const security = { recheckUser: (id: number) => timerStreams.recheck(id) };
  const streamCredentials = { check: (authentication: Authentication) => credentialCheck(storage, authentication) };
  const reports = new StorageReportRunner(storageConfig, storage);
  return {
    accounts: createAccountOperations(storage, security),
    entryEffects: createAccountEntryEffects<Repositories>(publish),
    timerStreams,
    publish,
    reports,
    /** Builds each timer stream's keep-alive credential check. */
    streamCredentials,
    /** The claim runs before the stream joins, so it never shares a group with a deleted account's streams. */
    openTimerStream(authentication: Authentication, res: EventStreamResponse): Promise<void> {
      publish.claim(authentication.user.id, authentication.user.createdAt);
      return timerStreams.open(authentication.user.id, res, streamCredentials.check(authentication));
    },
    /** Runs read queries in one snapshot, after checking the credential in that same snapshot. */
    readFor<T>(authentication: Authentication, work: (queries: ReadQueries) => Promise<T>, administrative = false) {
      return storage.readSnapshot(async repositories => {
        const user = await authenticatedUser(repositories, authentication);
        if (!user) throw refused();
        if (administrative && !isActiveAdmin(user)) throw forbidden('Admin access required');
        return work(createReadQueries(repositories, sessionDays));
      });
    },
    accountsFor: (authentication: Authentication) =>
      createAccountOperations(guardedStorage(storage, authentication, true), security),
    /** Preferences take only the user's guard, so their credential check runs before and after. */
    preferencesFor: (authentication: Authentication) =>
      createPreferenceOperations(guardedStorage(storage, authentication)),
    timersFor: (authentication: Authentication) =>
      presentTimerOperations(createTimerOperations(guardedStorage(storage, authentication), publish)),
    importsFor: (authentication: Authentication) =>
      createStorageImports(guardedStorage(storage, authentication), publish),
    entryWrite<T>(authentication: Authentication, work: (ctx: TransactionContext) => Promise<T>) {
      return guardedStorage(storage, authentication).transaction(work);
    },
    /** Runs a catalog write under the workspace guard and the guards of every timer it may change. */
    catalogWrite<T>(
      authentication: Authentication,
      wid: number,
      work: (ctx: TransactionContext, effects: CatalogTimerEffects) => Promise<T>,
    ) {
      return guardedStorage(storage, authentication).transaction(async ctx => {
        await ctx.lockWorkspaces([wid]);
        if (!(await ctx.workspaces.forMember(authentication.user.id, wid))) throw noWorkspaceAccess();
        await ctx.lockUsers([authentication.user.id, ...(await ctx.timers.affectedUsers(wid))]);
        return work(ctx, createCatalogTimerEffects(ctx, publish));
      });
    },
    async close() {
      const results = await Promise.allSettled([timerStreams.closeAll(), reports.close()]);
      // Streams are closed, so no new rebuild starts. Let started ones finish before storage closes.
      await settled();
      if (results.some(result => result.status === 'rejected')) throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
