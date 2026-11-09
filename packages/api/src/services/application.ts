/**
 * The application services the HTTP layer calls: domain operations bound to storage, the signed-in
 * credential checks around them, timer delivery, periodic maintenance and the report executor
 * `app.ts` builds. Each operation opens its own transaction and binds what it publishes, so a route parses, calls one
 * operation and presents the answer. Framework-free; `app.ts` composes them with the HTTP adapters.
 */
import type { Repositories, Storage } from '../domain/ports.ts';
import type { Id, User } from '../domain/model.ts';
import { createLocalTimerBus, type TimerBus } from '../storage/timerBus.ts';
import type { InviteRequest, ProfileUpdate, SettingChanges } from '../domain/accountCommands.ts';
import {
  createAccountOperations,
  createPreferenceOperations,
  type AccountEntryEffects,
  type AccountOperations,
  type AccountPasswordAttempt,
} from '../domain/accounts.ts';
import {
  authenticatedUser,
  isActiveAdmin,
  type AccountCredential,
  type Authentication,
} from '../domain/credentials.ts';
import { createReadQueries, type ReadQueries } from '../domain/queries.ts';
import { createAccountEntryEffects } from '../domain/timerEffects.ts';
import { createTimerOperations } from '../domain/timers.ts';
import { forbidden } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import { createImportAdmission, type ImportAdmissionOptions } from './importAdmission.ts';
import { createImportOperations } from './importJson.ts';
import type { ExportAssemblyJob, ExportEmitter } from './exportJobs.ts';
import type { ReportExecutor } from './reportRunner.ts';
import { createCatalogOperations } from './catalogOperations.ts';
import { createEntryOperations } from './entryOperations.ts';
import { credentialCheck, credentialKey } from './streamCredentials.ts';
import { startMaintenance } from './maintenance.ts';
import { createTimerDelivery } from './timerDelivery.ts';
import { presentTimerOperations, type PresentedTimerOperations } from './timerReplies.ts';
import type { EventStreamResponse, TimerStreamOptions } from './timerStreams.ts';

export interface ApplicationServiceOptions {
  storage: Storage;
  /** Runs reports and export assemblies. The services close it when they close. */
  reports: ReportExecutor;
  streamOptions?: TimerStreamOptions;
  /** Signals timer revisions to other processes. Defaults to the single-process bus. */
  bus?: TimerBus;
  logger?: Logger;
  /** The deployment's session length, used until an admin stores one. */
  sessionDays: number;
  /** How many imports run at once, in all and per account. */
  imports?: ImportAdmissionOptions;
}

const refused = () => forbidden('Incorrect username and/or password');

/** Write transactions that refuse a credential that no longer holds. */
type GuardedTransactions = Pick<Storage, 'transaction'>;
/** Guarded write transactions and read snapshots, for operations that also read without writing. */
type GuardedRunner = Pick<Storage, 'transaction' | 'readSnapshot'>;

/**
 * Transactions on `storage` that refuse a credential that no longer holds. Account operations
 * (`administrative`) check once under the instance guard. Other work checks before and again after
 * it ran, because it holds the actor's user guard only once the domain took it: a credential
 * changed while the write waited rolls the write back. Nothing else of `storage` is in reach.
 */
function guardedTransactions(
  storage: Storage,
  authentication: Authentication,
  administrative = false,
): GuardedTransactions {
  return {
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

/** Read snapshots on `storage` that check the credential in the same snapshot before `work` reads. */
function guardedSnapshot(storage: Storage, authentication: Authentication): Storage['readSnapshot'] {
  return work =>
    storage.readSnapshot(async repositories => {
      if (!(await authenticatedUser(repositories, authentication))) throw refused();
      return work(repositories);
    });
}

/** Guarded transactions and guarded read snapshots: what account and timer operations take. */
function guardedRunner(storage: Storage, authentication: Authentication, administrative = false): GuardedRunner {
  return {
    ...guardedTransactions(storage, authentication, administrative),
    readSnapshot: guardedSnapshot(storage, authentication),
  };
}

/**
 * The account operations with the deployment's session length and the timer effects of a time
 * zone change or an account deletion bound in, so a caller passes only what the request says.
 */
function boundAccountOperations(
  operations: AccountOperations<Repositories>,
  effects: AccountEntryEffects<Repositories>,
  sessionDays: number,
) {
  return {
    ...operations,
    deleteAccount: (actorId: Id, userId: Id, email: string | undefined) =>
      operations.deleteAccount(actorId, userId, email, effects),
    updateProfile: (
      seen: User,
      credential: AccountCredential,
      update: ProfileUpdate,
      attempt?: AccountPasswordAttempt,
    ) => operations.updateProfile(seen, credential, update, effects, attempt),
    createInvite: (actorId: Id, request: InviteRequest) => operations.createInvite(actorId, request, sessionDays),
    updateSettings: (actorId: Id, changes: SettingChanges) => operations.updateSettings(actorId, changes, sessionDays),
  };
}
export type SignedInAccountOperations = ReturnType<typeof boundAccountOperations>;

export function createApplicationServices({
  storage,
  reports,
  streamOptions,
  bus = createLocalTimerBus(),
  logger = silentLogger,
  sessionDays,
  imports,
}: ApplicationServiceOptions) {
  const { timerStreams, publish, settled } = createTimerDelivery({ storage, bus, logger, streamOptions });
  const security = { recheckUser: (id: number) => timerStreams.recheck(id) };
  const streamCredentials = { check: (authentication: Authentication) => credentialCheck(storage, authentication) };
  const entryEffects = createAccountEntryEffects<Repositories>(publish);
  const maintenance = startMaintenance(storage, { logger });
  /** Runs read queries in one snapshot, after checking the credential in that same snapshot. */
  function readFor<T>(
    authentication: Authentication,
    work: (queries: ReadQueries) => Promise<T>,
    administrative = false,
  ) {
    return storage.readSnapshot(async repositories => {
      const user = await authenticatedUser(repositories, authentication);
      if (!user) throw refused();
      if (administrative && !isActiveAdmin(user)) throw forbidden('Admin access required');
      return work(createReadQueries(repositories, sessionDays));
    });
  }
  return {
    accounts: createAccountOperations(storage, security),
    timerStreams,
    publish,
    reports,
    /** Builds each timer stream's keep-alive credential check. */
    streamCredentials,
    /** The claim runs before the stream joins, so it never shares a group with a deleted account's streams. */
    openTimerStream(authentication: Authentication, res: EventStreamResponse): Promise<void> {
      publish.claim(authentication.user.id, authentication.user.createdAt);
      return timerStreams.open(
        authentication.user.id,
        res,
        streamCredentials.check(authentication),
        credentialKey(authentication),
      );
    },
    readFor,
    /** Admits an import before it reads its file, or refuses it with a 503 and `Retry-After`. */
    importAdmission: createImportAdmission(imports),
    /**
     * Takes a place in the report runner's download lane, then writes the signed-in account's export
     * to `output`, a batch of entries at a time, after checking the credential in the export's own
     * snapshot. A full lane or a cancelled request reads nothing.
     */
    exportAccount(
      authentication: Authentication,
      assembly: ExportAssemblyJob,
      output: ExportEmitter,
      options: { signal?: AbortSignal } = {},
    ): Promise<void> {
      const userId = authentication.user.id;
      return reports.reserveDownload({ userId, signal: options.signal }, slot =>
        slot.export(assembly, output, { authentication }),
      );
    },
    accountsFor: (authentication: Authentication): SignedInAccountOperations =>
      boundAccountOperations(
        createAccountOperations(guardedRunner(storage, authentication, true), security),
        entryEffects,
        sessionDays,
      ),
    /** Preferences take only the user's guard, so their credential check runs before and after. */
    preferencesFor: (authentication: Authentication) =>
      createPreferenceOperations(guardedTransactions(storage, authentication)),
    timersFor: (authentication: Authentication): PresentedTimerOperations =>
      presentTimerOperations(
        createTimerOperations(guardedRunner(storage, authentication), authentication.user, publish),
      ),
    importsFor: (authentication: Authentication) =>
      createImportOperations(guardedTransactions(storage, authentication), publish),
    entriesFor: (authentication: Authentication) =>
      createEntryOperations(guardedTransactions(storage, authentication), authentication.user, publish),
    catalogsFor: (authentication: Authentication) =>
      createCatalogOperations(guardedTransactions(storage, authentication), authentication.user.id, publish),
    async close() {
      const results = await Promise.allSettled([timerStreams.closeAll(), reports.close(), maintenance.close()]);
      // Streams are closed, so no new rebuild starts. Let started ones finish before storage closes.
      await settled();
      if (results.some(result => result.status === 'rejected')) throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
