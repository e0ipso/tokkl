/** Each operation opens its own transaction and binds what it publishes. Framework-free. */
import type { Clock, Repositories, Storage, TimerBus } from '../domain/ports.ts';
import type { Id } from '../domain/model.ts';
import type {
  AccessChange,
  InviteRequest,
  ProfileUpdate,
  SettingChanges,
  WorkspaceChanges,
} from '../domain/accountCommands.ts';
import {
  createAccountOperations,
  createPreferenceOperations,
  type AccountOperations,
  type AccountPasswordAttempt,
} from '../domain/accounts.ts';
import type { AccountSecurityEffects } from '../domain/accountGuards.ts';
import { createInviteOperations } from '../domain/accountLinks.ts';
import { authenticatedUser, isActiveAdmin, type Authentication } from '../domain/credentials.ts';
import { createReadQueries, type ReadQueries } from '../domain/queries.ts';
import { createAccountEntryEffects } from '../domain/timerEffects.ts';
import { createTimerOperations } from '../domain/timers.ts';
import { forbidden } from '../lib/errors.ts';
import { silentLogger, type Logger } from '../lib/logger.ts';
import { createImportAdmission } from './importAdmission.ts';
import { createImportOperations } from './importJson.ts';
import type { ExportAssemblyJob, ExportEmitter } from './exportJobs.ts';
import type { ReportExecutor } from './reportRunner.ts';
import { createCatalogOperations } from './catalogOperations.ts';
import { createEntryOperations } from './entryOperations.ts';
import { startMaintenance } from './maintenance.ts';
import {
  createTimerDelivery,
  credentialCheck,
  credentialKey,
  presentTimerOperations,
  type PresentedTimerOperations,
} from './timerDelivery.ts';
import {
  DEFAULT_TIMER_STREAM_LIMITS,
  type EventStreamResponse,
  type TimerStreamLimits,
  type TimerStreams,
} from './timerStreams.ts';

export interface ServiceSettings {
  timerStreams: Readonly<TimerStreamLimits>;
}

export const DEFAULT_SERVICE_SETTINGS: Readonly<ServiceSettings> = Object.freeze({
  timerStreams: DEFAULT_TIMER_STREAM_LIMITS,
});

interface ApplicationServiceOptions {
  storage: Storage;
  /** The services close it when they close. */
  reports: ReportExecutor;
  settings: Readonly<ServiceSettings>;
  bus: TimerBus;
  clock: Clock;
  logger?: Logger;
  /** Used until an admin stores one. */
  sessionDays: number;
}

const refused = () => forbidden('Incorrect username and/or password');

type GuardedTransactions = Pick<Storage, 'transaction'>;
type GuardedRunner = Pick<Storage, 'transaction' | 'readSnapshot'>;

/** Admin operations check once under the instance guard; others check before and after, rolling back on a change. */
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

/** Checks the credential in the same snapshot before `work` reads. */
function guardedSnapshot(storage: Storage, authentication: Authentication): Storage['readSnapshot'] {
  return work =>
    storage.readSnapshot(async repositories => {
      if (!(await authenticatedUser(repositories, authentication))) throw refused();
      return work(repositories);
    });
}

function guardedRunner(storage: Storage, authentication: Authentication, administrative = false): GuardedRunner {
  return {
    ...guardedTransactions(storage, authentication, administrative),
    readSnapshot: guardedSnapshot(storage, authentication),
  };
}

const accountSecurity = (timerStreams: Pick<TimerStreams, 'recheck'>): AccountSecurityEffects => ({
  recheckUser: id => timerStreams.recheck(id),
});

/** No credential check: these run before the request has one. Routers use the guarded `accountsFor`. */
export function createSessionAccountOperations(
  storage: Storage,
  services: Pick<ApplicationServices, 'timerStreams'>,
): AccountOperations<Repositories> {
  return createAccountOperations(storage, accountSecurity(services.timerStreams));
}

export function createApplicationServices({
  storage,
  reports,
  settings,
  bus,
  clock,
  logger = silentLogger,
  sessionDays,
}: ApplicationServiceOptions) {
  const { timerStreams, push, settled } = createTimerDelivery({
    storage,
    bus,
    clock,
    logger,
    streamLimits: settings.timerStreams,
  });
  const security = accountSecurity(timerStreams);
  const invites = createInviteOperations(storage);
  const streamCredentials = { check: (authentication: Authentication) => credentialCheck(storage, authentication) };
  const { publish } = push;
  const entryEffects = createAccountEntryEffects<Repositories>(push);
  const maintenance = startMaintenance(storage, { clock, logger });
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
    timerStreams,
    /** Public signup requests create links before a credential exists. */
    signupInvites: {
      createSignupInvite: (email: string) => invites.createSignupInvite(email, sessionDays),
      deleteSignupInvite: (id: Id, token?: string) => invites.deleteSignupInvite(id, token),
    },
    push,
    reports,
    streamCredentials,
    /** The claim runs before the stream joins, so it never shares a group with a deleted account's streams. */
    openTimerStream(authentication: Authentication, res: EventStreamResponse): Promise<void> {
      push.claim(authentication.user.id, authentication.user.createdAt);
      return timerStreams.open(
        authentication.user.id,
        res,
        streamCredentials.check(authentication),
        credentialKey(authentication),
      );
    },
    readFor,
    /** Refuses with a 503 and `Retry-After` before the file is read. */
    importAdmission: createImportAdmission(),
    /** A full lane or a cancelled request reads nothing. The credential is checked in the export's own snapshot. */
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
    accountsFor(authentication: Authentication) {
      const operations = createAccountOperations(guardedRunner(storage, authentication, true), security);
      const { user, credential } = authentication;
      const actorId = user.id;
      return {
        setAccess: (userId: Id, change: AccessChange) => operations.setAccess(actorId, userId, change),
        deleteAccount: (userId: Id, email: string | undefined) =>
          operations.deleteAccount(actorId, userId, email, entryEffects),
        revokeSessions: (userId: Id) => operations.revokeSessions(actorId, userId),
        createPasswordReset: (userId: Id) => operations.createPasswordReset(actorId, userId),
        createInvite: (request: InviteRequest) => operations.createInvite(actorId, request, sessionDays),
        revokeInvite: (id: Id) => operations.revokeInvite(actorId, id),
        updateSettings: (changes: SettingChanges) => operations.updateSettings(actorId, changes, sessionDays),
        updateWorkspace: (workspaceId: Id, changes: WorkspaceChanges) =>
          operations.updateWorkspace(actorId, workspaceId, changes),
        updateProfile: (update: ProfileUpdate, attempt?: AccountPasswordAttempt) =>
          operations.updateProfile(user, credential, update, entryEffects, attempt),
        rotateApiToken: () => operations.rotateApiToken(user, credential),
      };
    },
    /** Takes only the user's guard, so the credential check runs before and after. */
    preferencesFor: (authentication: Authentication) =>
      createPreferenceOperations(guardedTransactions(storage, authentication), authentication.user.id),
    timersFor: (authentication: Authentication): PresentedTimerOperations =>
      presentTimerOperations(
        createTimerOperations(guardedRunner(storage, authentication), authentication.user, publish, clock),
      ),
    importsFor: (authentication: Authentication) =>
      createImportOperations(guardedTransactions(storage, authentication), authentication.user.id, publish),
    entriesFor: (authentication: Authentication) =>
      createEntryOperations(guardedTransactions(storage, authentication), authentication.user, publish),
    catalogsFor: (authentication: Authentication) =>
      createCatalogOperations(guardedTransactions(storage, authentication), authentication.user.id, publish),
    async close() {
      // States already committed reach the open streams before they close.
      await settled();
      const results = await Promise.allSettled([timerStreams.closeAll(), reports.close(), maintenance.close()]);
      // A write still finishing may have published since. With the streams closed its delivery
      // sends nothing and no new refresh starts, but storage stays open until each one ends.
      await settled();
      if (results.some(result => result.status === 'rejected')) throw new Error('Application shutdown failed');
    },
  };
}
export type ApplicationServices = ReturnType<typeof createApplicationServices>;
