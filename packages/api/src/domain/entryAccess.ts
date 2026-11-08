/** Reading one user's entries and taking the guards every entry write needs, in a fixed order. */
import type { EntriesReader, OperationContext, ReadersOf, Repositories, SettingsReader } from './ports.ts';
import type { EntryDetails, Id, User } from './model.ts';
import { StorageConflict } from './ports.ts';
import { notFound } from '../lib/errors.ts';
import { timeResolutionOf } from './instanceSettings.ts';
import { noWorkspaceAccess } from './membership.ts';

export type EntryRepositories = Pick<
  Repositories,
  | 'users'
  | 'workspaces'
  | 'settings'
  | 'clients'
  | 'projects'
  | 'tasks'
  | 'tags'
  | 'entries'
  | 'idempotencyKeys'
  | 'timers'
>;
export type EntryContext = OperationContext<EntryRepositories>;
/** The reads a read-only snapshot gives an entry or timer operation. */
export type EntryReaders = ReadersOf<EntryRepositories>;
/**
 * Opens the write transactions entry and timer work runs in, with only the entry repositories in
 * reach. A `Storage` is one.
 */
export interface EntryTransactions {
  transaction<T>(work: (context: EntryContext) => Promise<T>): Promise<T>;
}

export async function getTimeEntry(
  ctx: { entries: Pick<EntriesReader, 'get'> },
  userId: Id,
  id: Id,
  options: { includeDeleted?: boolean } = {},
): Promise<EntryDetails> {
  const row = await ctx.entries.get(userId, id, options.includeDeleted);
  if (!row) throw notFound('Time entry not found');
  return row;
}

/** The user's live entry `id` when it is in workspace `wid`, else the same 404 as a missing one. */
export async function getEntryIn(
  ctx: { entries: Pick<EntriesReader, 'get'> },
  userId: Id,
  wid: Id,
  id: Id,
): Promise<EntryDetails> {
  const entry = await getTimeEntry(ctx, userId, id);
  if (entry.workspaceId !== wid) throw notFound('Time entry not found');
  return entry;
}

/** Discover workspace guards before the stable user parent. Recheck discovery under that
 * parent; an overtaken discovery restarts the transaction instead of taking a lower guard. */
export async function protectEntryOperation(
  ctx: EntryContext,
  userId: Id,
  workspaceIds: Id[] = [],
  includeDefault = false,
): Promise<User> {
  const existing = await ctx.users.get(userId);
  if (!existing) throw notFound('User not found');
  const running = await ctx.entries.running(userId),
    pause = await ctx.timers.getPauseChain(userId);
  const ids = [
    ...new Set([
      ...workspaceIds,
      ...(includeDefault ? [existing.defaultWorkspaceId] : []),
      ...(running ? [running.workspaceId] : []),
      ...(pause ? [pause.workspaceId] : []),
    ]),
  ];
  for (const wid of ids) if (!(await ctx.workspaces.get(wid))) throw noWorkspaceAccess();
  await ctx.lockWorkspaces(ids);
  await ctx.lockUserTimer(userId);
  const user = await ctx.users.get(userId);
  if (!user) throw notFound('User not found');
  const current = await ctx.entries.running(userId),
    chain = await ctx.timers.getPauseChain(userId);
  if (
    (current && !ids.includes(current.workspaceId)) ||
    (chain && !ids.includes(chain.workspaceId)) ||
    (includeDefault && !ids.includes(user.defaultWorkspaceId))
  )
    throw new StorageConflict('serialization');
  return user;
}

/** The instance's time resolution in minutes. */
export async function entryResolution(ctx: { settings: Pick<SettingsReader, 'read'> }): Promise<number> {
  return timeResolutionOf(await ctx.settings.read());
}
