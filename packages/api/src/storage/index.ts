import type { StorageConnection } from './connections.ts';
import type { PhysicalDatabase } from './physical.ts';
import type { Repositories, Storage, TransactionContext } from './contracts.ts';
import { createTransactionRunner } from './transactions.ts';
import { createAccountRepositories } from './repositories/accounts.ts';
import { createCatalogRepositories } from './repositories/catalogs.ts';
import { createEntryRepositories } from './repositories/entries.ts';
import { createTimerRepositories } from './repositories/timers.ts';
import { createTransferRepositories } from './repositories/transfers.ts';
import { createReportRepositories } from './repositories/reports.ts';
/** Takes ownership of an initialized connection. Every operation binds all repositories together. */
export function createStorage(connection: StorageConnection<PhysicalDatabase>): Storage {
  const operations = createTransactionRunner(connection, db => ({
    ...createAccountRepositories(db, connection.backend),
    ...createCatalogRepositories(db, connection.backend),
    ...createEntryRepositories(db, connection.backend),
    ...createTimerRepositories(db, connection.backend),
    ...createTransferRepositories(db, connection.backend),
    ...createReportRepositories(db, connection.backend),
  }));
  const active = new Set<Promise<unknown>>();
  let accepting = true;
  let closing: Promise<void> | undefined;
  function track<T>(work: () => Promise<T>): Promise<T> {
    if (!accepting) return Promise.reject(new Error('Storage is closed'));
    const pending = work(); active.add(pending);
    void pending.then(() => active.delete(pending), () => active.delete(pending));
    return pending;
  }
  const runner = {
    transaction<T>(work: (ctx: TransactionContext) => Promise<T>, options?: { dryRun?: boolean }): Promise<T> {
      return track(() => operations.transaction(work, options));
    },
    readSnapshot<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
      return track(() => operations.readSnapshot(work));
    },
  };
  return {
    users: {
      count: (...args: Parameters<Repositories['users']['count']>) => runner.readSnapshot(r => r.users.count(...args)),
      countActiveAdmins: (...args: Parameters<Repositories['users']['countActiveAdmins']>) => runner.readSnapshot(r => r.users.countActiveAdmins(...args)),
      get: (...args: Parameters<Repositories['users']['get']>) => runner.readSnapshot(r => r.users.get(...args)),
      findByEmail: (...args: Parameters<Repositories['users']['findByEmail']>) => runner.readSnapshot(r => r.users.findByEmail(...args)),
      findByApiToken: (...args: Parameters<Repositories['users']['findByApiToken']>) => runner.readSnapshot(r => r.users.findByApiToken(...args)),
      list: (...args: Parameters<Repositories['users']['list']>) => runner.readSnapshot(r => r.users.list(...args)),
      createAccount: (...args: Parameters<Repositories['users']['createAccount']>) => runner.transaction(r => r.users.createAccount(...args)),
      updateAccount: (...args: Parameters<Repositories['users']['updateAccount']>) => runner.transaction(r => r.users.updateAccount(...args)),
      setPreferences: (...args: Parameters<Repositories['users']['setPreferences']>) => runner.transaction(r => r.users.setPreferences(...args)),
      changeCredentials: (...args: Parameters<Repositories['users']['changeCredentials']>) => runner.transaction(r => r.users.changeCredentials(...args)),
      rotateApiToken: (...args: Parameters<Repositories['users']['rotateApiToken']>) => runner.transaction(r => r.users.rotateApiToken(...args)),
      setAccess: (...args: Parameters<Repositories['users']['setAccess']>) => runner.transaction(r => r.users.setAccess(...args)),
      delete: (...args: Parameters<Repositories['users']['delete']>) => runner.transaction(r => r.users.delete(...args)),
    },
    workspaces: {
      get: (...args: Parameters<Repositories['workspaces']['get']>) => runner.readSnapshot(r => r.workspaces.get(...args)),
      forMember: (...args: Parameters<Repositories['workspaces']['forMember']>) => runner.readSnapshot(r => r.workspaces.forMember(...args)),
      listForUser: (...args: Parameters<Repositories['workspaces']['listForUser']>) => runner.readSnapshot(r => r.workspaces.listForUser(...args)),
      create: (...args: Parameters<Repositories['workspaces']['create']>) => runner.transaction(r => r.workspaces.create(...args)),
      update: (...args: Parameters<Repositories['workspaces']['update']>) => runner.transaction(r => r.workspaces.update(...args)),
      getRole: (...args: Parameters<Repositories['workspaces']['getRole']>) => runner.readSnapshot(r => r.workspaces.getRole(...args)),
      addMember: (...args: Parameters<Repositories['workspaces']['addMember']>) => runner.transaction(r => r.workspaces.addMember(...args)),
      countMembers: (...args: Parameters<Repositories['workspaces']['countMembers']>) => runner.readSnapshot(r => r.workspaces.countMembers(...args)),
      listMembers: (...args: Parameters<Repositories['workspaces']['listMembers']>) => runner.readSnapshot(r => r.workspaces.listMembers(...args)),
      deleteSoleMemberWorkspaces: (...args: Parameters<Repositories['workspaces']['deleteSoleMemberWorkspaces']>) => runner.transaction(r => r.workspaces.deleteSoleMemberWorkspaces(...args)),
    },
    settings: {
      read: (...args: Parameters<Repositories['settings']['read']>) => runner.readSnapshot(r => r.settings.read(...args)),
      write: (...args: Parameters<Repositories['settings']['write']>) => runner.transaction(r => r.settings.write(...args)),
    },
    tokens: {
      create: (...args: Parameters<Repositories['tokens']['create']>) => runner.transaction(r => r.tokens.create(...args)),
      listPendingInvites: (...args: Parameters<Repositories['tokens']['listPendingInvites']>) => runner.readSnapshot(r => r.tokens.listPendingInvites(...args)),
      findUsable: (...args: Parameters<Repositories['tokens']['findUsable']>) => runner.readSnapshot(r => r.tokens.findUsable(...args)),
      consume: (...args: Parameters<Repositories['tokens']['consume']>) => runner.transaction(r => r.tokens.consume(...args)),
      revokeInvite: (...args: Parameters<Repositories['tokens']['revokeInvite']>) => runner.transaction(r => r.tokens.revokeInvite(...args)),
      revokeInvitesCreatedBy: (...args: Parameters<Repositories['tokens']['revokeInvitesCreatedBy']>) => runner.transaction(r => r.tokens.revokeInvitesCreatedBy(...args)),
      revokeUnusedPasswordResets: (...args: Parameters<Repositories['tokens']['revokeUnusedPasswordResets']>) => runner.transaction(r => r.tokens.revokeUnusedPasswordResets(...args)),
    },
    sessions: {
      create: (...args: Parameters<Repositories['sessions']['create']>) => runner.transaction(r => r.sessions.create(...args)),
      find: (...args: Parameters<Repositories['sessions']['find']>) => runner.readSnapshot(r => r.sessions.find(...args)),
      delete: (...args: Parameters<Repositories['sessions']['delete']>) => runner.transaction(r => r.sessions.delete(...args)),
      deleteForUser: (...args: Parameters<Repositories['sessions']['deleteForUser']>) => runner.transaction(r => r.sessions.deleteForUser(...args)),
      deleteExpired: (...args: Parameters<Repositories['sessions']['deleteExpired']>) => runner.transaction(r => r.sessions.deleteExpired(...args)),
    },
    clients: {
      list: (...args: Parameters<Repositories['clients']['list']>) => runner.readSnapshot(r => r.clients.list(...args)),
      get: (...args: Parameters<Repositories['clients']['get']>) => runner.readSnapshot(r => r.clients.get(...args)),
      findByName: (...args: Parameters<Repositories['clients']['findByName']>) => runner.readSnapshot(r => r.clients.findByName(...args)),
      create: (...args: Parameters<Repositories['clients']['create']>) => runner.transaction(r => r.clients.create(...args)),
      update: (...args: Parameters<Repositories['clients']['update']>) => runner.transaction(r => r.clients.update(...args)),
      restore: (...args: Parameters<Repositories['clients']['restore']>) => runner.transaction(r => r.clients.restore(...args)),
      setArchived: (...args: Parameters<Repositories['clients']['setArchived']>) => runner.transaction(r => r.clients.setArchived(...args)),
      deleteAndDetachProjects: (...args: Parameters<Repositories['clients']['deleteAndDetachProjects']>) => runner.transaction(r => r.clients.deleteAndDetachProjects(...args)),
    },
    projects: {
      count: (...args: Parameters<Repositories['projects']['count']>) => runner.readSnapshot(r => r.projects.count(...args)),
      getMetadata: (...args: Parameters<Repositories['projects']['getMetadata']>) => runner.readSnapshot(r => r.projects.getMetadata(...args)),
      listForClient: (...args: Parameters<Repositories['projects']['listForClient']>) => runner.readSnapshot(r => r.projects.listForClient(...args)),
      list: (...args: Parameters<Repositories['projects']['list']>) => runner.readSnapshot(r => r.projects.list(...args)),
      get: (...args: Parameters<Repositories['projects']['get']>) => runner.readSnapshot(r => r.projects.get(...args)),
      getRef: (...args: Parameters<Repositories['projects']['getRef']>) => runner.readSnapshot(r => r.projects.getRef(...args)),
      findByName: (...args: Parameters<Repositories['projects']['findByName']>) => runner.readSnapshot(r => r.projects.findByName(...args)),
      create: (...args: Parameters<Repositories['projects']['create']>) => runner.transaction(r => r.projects.create(...args)),
      update: (...args: Parameters<Repositories['projects']['update']>) => runner.transaction(r => r.projects.update(...args)),
      delete: (...args: Parameters<Repositories['projects']['delete']>) => runner.transaction(r => r.projects.delete(...args)),
    },
    tasks: {
      getMetadata: (...args: Parameters<Repositories['tasks']['getMetadata']>) => runner.readSnapshot(r => r.tasks.getMetadata(...args)),
      list: (...args: Parameters<Repositories['tasks']['list']>) => runner.readSnapshot(r => r.tasks.list(...args)),
      get: (...args: Parameters<Repositories['tasks']['get']>) => runner.readSnapshot(r => r.tasks.get(...args)),
      getRef: (...args: Parameters<Repositories['tasks']['getRef']>) => runner.readSnapshot(r => r.tasks.getRef(...args)),
      findByName: (...args: Parameters<Repositories['tasks']['findByName']>) => runner.readSnapshot(r => r.tasks.findByName(...args)),
      create: (...args: Parameters<Repositories['tasks']['create']>) => runner.transaction(r => r.tasks.create(...args)),
      update: (...args: Parameters<Repositories['tasks']['update']>) => runner.transaction(r => r.tasks.update(...args)),
      delete: (...args: Parameters<Repositories['tasks']['delete']>) => runner.transaction(r => r.tasks.delete(...args)),
    },
    tags: {
      list: (...args: Parameters<Repositories['tags']['list']>) => runner.readSnapshot(r => r.tags.list(...args)),
      findByIds: (...args: Parameters<Repositories['tags']['findByIds']>) => runner.readSnapshot(r => r.tags.findByIds(...args)),
      get: (...args: Parameters<Repositories['tags']['get']>) => runner.readSnapshot(r => r.tags.get(...args)),
      findByName: (...args: Parameters<Repositories['tags']['findByName']>) => runner.readSnapshot(r => r.tags.findByName(...args)),
      resolveNames: (...args: Parameters<Repositories['tags']['resolveNames']>) => runner.transaction(r => r.tags.resolveNames(...args)),
      create: (...args: Parameters<Repositories['tags']['create']>) => runner.transaction(r => r.tags.create(...args)),
      rename: (...args: Parameters<Repositories['tags']['rename']>) => runner.transaction(r => r.tags.rename(...args)),
      delete: (...args: Parameters<Repositories['tags']['delete']>) => runner.transaction(r => r.tags.delete(...args)),
    },
    entries: {
      list: (...args: Parameters<Repositories['entries']['list']>) => runner.readSnapshot(r => r.entries.list(...args)),
      get: (...args: Parameters<Repositories['entries']['get']>) => runner.readSnapshot(r => r.entries.get(...args)),
      running: (...args: Parameters<Repositories['entries']['running']>) => runner.readSnapshot(r => r.entries.running(...args)),
      bounds: (...args: Parameters<Repositories['entries']['bounds']>) => runner.readSnapshot(r => r.entries.bounds(...args)),
      create: (...args: Parameters<Repositories['entries']['create']>) => runner.transaction(r => r.entries.create(...args)),
      insert: (...args: Parameters<Repositories['entries']['insert']>) => runner.transaction(r => r.entries.insert(...args)),
      update: (...args: Parameters<Repositories['entries']['update']>) => runner.transaction(r => r.entries.update(...args)),
      setTags: (...args: Parameters<Repositories['entries']['setTags']>) => runner.transaction(r => r.entries.setTags(...args)),
      softDelete: (...args: Parameters<Repositories['entries']['softDelete']>) => runner.transaction(r => r.entries.softDelete(...args)),
      restore: (...args: Parameters<Repositories['entries']['restore']>) => runner.transaction(r => r.entries.restore(...args)),
      listDeleted: (...args: Parameters<Repositories['entries']['listDeleted']>) => runner.readSnapshot(r => r.entries.listDeleted(...args)),
      purgeDeleted: (...args: Parameters<Repositories['entries']['purgeDeleted']>) => runner.transaction(r => r.entries.purgeDeleted(...args)),
      listAllDay: (...args: Parameters<Repositories['entries']['listAllDay']>) => runner.readSnapshot(r => r.entries.listAllDay(...args)),
      findDuplicate: (...args: Parameters<Repositories['entries']['findDuplicate']>) => runner.readSnapshot(r => r.entries.findDuplicate(...args)),
    },
    timers: {
      read: (...args: Parameters<Repositories['timers']['read']>) => runner.readSnapshot(r => r.timers.read(...args)),
      getSession: (...args: Parameters<Repositories['timers']['getSession']>) => runner.readSnapshot(r => r.timers.getSession(...args)),
      saveSession: (...args: Parameters<Repositories['timers']['saveSession']>) => runner.transaction(r => r.timers.saveSession(...args)),
      deleteSession: (...args: Parameters<Repositories['timers']['deleteSession']>) => runner.transaction(r => r.timers.deleteSession(...args)),
      getPauseChain: (...args: Parameters<Repositories['timers']['getPauseChain']>) => runner.readSnapshot(r => r.timers.getPauseChain(...args)),
      savePauseChain: (...args: Parameters<Repositories['timers']['savePauseChain']>) => runner.transaction(r => r.timers.savePauseChain(...args)),
      deletePauseChain: (...args: Parameters<Repositories['timers']['deletePauseChain']>) => runner.transaction(r => r.timers.deletePauseChain(...args)),
      removeTagFromPauseChains: (...args: Parameters<Repositories['timers']['removeTagFromPauseChains']>) => runner.transaction(r => r.timers.removeTagFromPauseChains(...args)),
      getRevision: (...args: Parameters<Repositories['timers']['getRevision']>) => runner.readSnapshot(r => r.timers.getRevision(...args)),
      saveRevision: (...args: Parameters<Repositories['timers']['saveRevision']>) => runner.transaction(r => r.timers.saveRevision(...args)),
      affectedUsers: (...args: Parameters<Repositories['timers']['affectedUsers']>) => runner.readSnapshot(r => r.timers.affectedUsers(...args)),
    },
    reports: {
      collect: (...args: Parameters<Repositories['reports']['collect']>) => runner.readSnapshot(r => r.reports.collect(...args)),
    },
    transfers: {
      exportAccount: (...args: Parameters<Repositories['transfers']['exportAccount']>) => runner.readSnapshot(r => r.transfers.exportAccount(...args)),
      hasRunningEntry: (...args: Parameters<Repositories['transfers']['hasRunningEntry']>) => runner.readSnapshot(r => r.transfers.hasRunningEntry(...args)),
    },
    transaction: runner.transaction, readSnapshot: runner.readSnapshot,
    health: () => track(() => connection.health()),
    close: () => closing ??= (async () => {
      accepting = false;
      while (active.size) await Promise.allSettled([...active]);
      await connection.close();
    })(),
  };
}
