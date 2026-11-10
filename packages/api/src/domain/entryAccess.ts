import type { EntriesRepository, OperationContext, Repositories, SettingsRepository } from './ports.ts';
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
/** A `Storage` is one. */
export interface EntryTransactions {
  transaction<T>(work: (context: EntryContext) => Promise<T>): Promise<T>;
}

export async function getTimeEntry(
  ctx: { entries: Pick<EntriesRepository, 'get'> },
  userId: Id,
  id: Id,
  options: { includeDeleted?: boolean } = {},
): Promise<EntryDetails> {
  const row = await ctx.entries.get(userId, id, options.includeDeleted);
  if (!row) throw notFound('Time entry not found');
  return row;
}

/** Else the same 404 as a missing entry. */
export async function getEntryIn(
  ctx: { entries: Pick<EntriesRepository, 'get'> },
  userId: Id,
  wid: Id,
  id: Id,
): Promise<EntryDetails> {
  const entry = await getTimeEntry(ctx, userId, id);
  if (entry.workspaceId !== wid) throw notFound('Time entry not found');
  return entry;
}

/** Rechecks workspace guards under the user lock; an overtaken discovery restarts the transaction. */
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

export async function entryResolution(ctx: { settings: Pick<SettingsRepository, 'read'> }): Promise<number> {
  return timeResolutionOf(await ctx.settings.read());
}
