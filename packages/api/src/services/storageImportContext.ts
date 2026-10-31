import type { OperationContext } from '../storage/contracts.ts';
import type { EntryRepositories } from '../domain/timeEntries.ts';
import { memberWorkspace, protectEntryOperation } from '../domain/timeEntries.ts';
import { forbidden } from '../lib/errors.ts';
import { StorageConflict } from '../storage/errors.ts';

export interface ImportRunner<R extends EntryRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>, options?: { dryRun?: boolean }): Promise<T>;
}
/** Catalog effects can touch every timer owner. Lock their complete set before the caller. */
export async function protectImport(ctx: OperationContext<EntryRepositories>, userId: number) {
  const observed = await ctx.users.get(userId);
  if (!observed) return protectEntryOperation(ctx, userId, [], true);
  const running = await ctx.entries.running(userId), pause = await ctx.timers.getPauseChain(userId);
  const wids = [...new Set([observed.defaultWorkspaceId, ...(running ? [running.workspaceId] : []), ...(pause ? [pause.workspaceId] : [])])];
  for (const wid of wids) if (!await ctx.workspaces.get(wid)) throw forbidden('User does not have access to this resource.');
  await ctx.lockWorkspaces(wids);
  await ctx.lockUsers([...await ctx.timers.affectedUsers(observed.defaultWorkspaceId), userId]);
  const user = await ctx.users.get(userId), current = await ctx.entries.running(userId), chain = await ctx.timers.getPauseChain(userId);
  if (!user || user.defaultWorkspaceId !== observed.defaultWorkspaceId || (current && !wids.includes(current.workspaceId)) || (chain && !wids.includes(chain.workspaceId))) {
    throw new StorageConflict('serialization');
  }
  const locked = await protectEntryOperation(ctx, userId, wids, true);
  await memberWorkspace(ctx, userId, locked.defaultWorkspaceId);
  return locked;
}
export function importError(error: unknown, fallback: string): string {
  if (error instanceof StorageConflict && ['serialization', 'deadlock', 'busy'].includes(error.kind)) throw error;
  return error instanceof Error ? error.message : fallback;
}
