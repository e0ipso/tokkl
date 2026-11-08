import type { Repositories, Storage } from '../../src/storage/contracts.ts';
import { createStorage as createPlainStorage } from '../../src/storage/index.ts';

/**
 * Storage plus one-call repository access for tests: `storage.users.get(id)` runs in its own read
 * snapshot and `storage.entries.insert(row)` in its own write transaction. Production code always
 * opens the unit of work itself; this exists so fixtures can seed and inspect rows in one line.
 */
export type StorageWithShortcuts = Storage & Repositories;

type MethodsOf<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];

/** The methods that only read. Everything else runs in a write transaction. */
const READS: { [R in keyof Repositories]: ReadonlyArray<MethodsOf<Repositories[R]>> } = {
  users: ['count', 'countActiveAdmins', 'get', 'getWithTimerRevision', 'findByEmail', 'findByApiToken', 'list'],
  workspaces: ['get', 'forMember', 'listForUser', 'getRole', 'countMembers', 'listMembers'],
  settings: ['read'],
  tokens: ['listPendingInvites', 'findUsable'],
  sessions: ['find'],
  rateLimits: [],
  clients: ['list', 'get', 'findByName'],
  projects: ['count', 'getMetadata', 'listForClient', 'list', 'get', 'getRef', 'findByName'],
  tasks: ['getMetadata', 'list', 'get', 'getRef', 'findByName'],
  tags: ['list', 'findByIds', 'get', 'findByName'],
  entries: ['list', 'get', 'running', 'bounds', 'listDeleted', 'listAllDay', 'findDuplicate'],
  timers: ['read', 'getSession', 'getPauseChain', 'getRevision', 'affectedUsers'],
  reports: ['collect'],
  transfers: ['exportAccount'],
};

function shortcuts<R extends keyof Repositories>(storage: Storage, name: R): Repositories[R] {
  const reads = READS[name] as readonly PropertyKey[];
  return new Proxy({} as Repositories[R], {
    get(_target, method) {
      const call = (repositories: Repositories, args: unknown[]) =>
        (repositories[name][method as keyof Repositories[R]] as (...args: unknown[]) => Promise<unknown>)(...args);
      return (...args: unknown[]) =>
        reads.includes(method)
          ? // READS names reader methods only, which every snapshot repository has.
            storage.readSnapshot(repositories => call(repositories as Repositories, args))
          : storage.transaction(ctx => call(ctx, args));
    },
  });
}

export function withShortcuts(storage: Storage): StorageWithShortcuts {
  const names = Object.keys(READS) as Array<keyof Repositories>;
  return Object.assign(
    { ...storage },
    Object.fromEntries(names.map(name => [name, shortcuts(storage, name)])) as unknown as Repositories,
  );
}

/** `createStorage` with shortcuts, for tests that open their own connection. */
export function createStorage(...args: Parameters<typeof createPlainStorage>): StorageWithShortcuts {
  return withShortcuts(createPlainStorage(...args));
}
