import { setImmediate as nextTurn } from 'node:timers/promises';
import type { OperationContext } from '../domain/ports.ts';
import { protectEntryOperation, type EntryRepositories } from '../domain/entryAccess.ts';
import { memberWorkspace, noWorkspaceAccess } from '../domain/membership.ts';
import { StorageConflict } from '../domain/ports.ts';
import { ApplicationError, RequestCancelled } from '../lib/errors.ts';
import { isImportLimit } from './importPolicy.ts';

/** The rest are counted in the totals only. */
export const MAX_IMPORT_ERRORS = 100;

export interface ImportRunner<R extends EntryRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>, options?: { dryRun?: boolean }): Promise<T>;
}
/** Catalog effects can touch every timer owner, so lock their complete set first. */
export async function protectImport(ctx: OperationContext<EntryRepositories>, userId: number) {
  const observed = await ctx.users.get(userId);
  if (!observed) return protectEntryOperation(ctx, userId, [], true);
  const running = await ctx.entries.running(userId),
    pause = await ctx.timers.getPauseChain(userId);
  const wids = [
    ...new Set([
      observed.defaultWorkspaceId,
      ...(running ? [running.workspaceId] : []),
      ...(pause ? [pause.workspaceId] : []),
    ]),
  ];
  for (const wid of wids) if (!(await ctx.workspaces.get(wid))) throw noWorkspaceAccess();
  await ctx.lockWorkspaces(wids);
  await ctx.lockUsers([...(await ctx.timers.affectedUsers(observed.defaultWorkspaceId)), userId]);
  const user = await ctx.users.get(userId),
    current = await ctx.entries.running(userId),
    chain = await ctx.timers.getPauseChain(userId);
  if (
    !user ||
    user.defaultWorkspaceId !== observed.defaultWorkspaceId ||
    (current && !wids.includes(current.workspaceId)) ||
    (chain && !wids.includes(chain.workspaceId))
  ) {
    throw new StorageConflict('serialization');
  }
  const locked = await protectEntryOperation(ctx, userId, wids, true);
  await memberWorkspace(ctx, userId, locked.defaultWorkspaceId);
  return locked;
}
/** Imports that pass their deadline will likely pass it again; this spaces the retries. */
const DEADLINE_RETRY_SECONDS = 60;
/** Records between two turns of the event loop, so a long import never holds the process. */
const RECORDS_PER_TURN = 50;

/** The import passed its processing deadline and rolled back whole: a 503 with `Retry-After`. */
export class ImportDeadlineExceeded extends ApplicationError {
  constructor() {
    super('unavailable', 'The import took too long; split the file and try again', DEADLINE_RETRY_SECONDS);
    this.name = 'ImportDeadlineExceeded';
  }
}

/** A signal that timed out ends the import at its deadline; any other abort means the client or server went away. */
export function checkCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof DOMException && reason.name === 'TimeoutError') throw new ImportDeadlineExceeded();
  throw new RequestCancelled('Import cancelled');
}

/**
 * Checks before each record, outside its savepoint, which would report the failure as the record's. Every
 * `RECORDS_PER_TURN` records it first yields to the event loop, so timers, other requests and the deadline run.
 */
export function recordBoundary(signal: AbortSignal | undefined): () => Promise<void> {
  let records = 0;
  return async () => {
    if (++records % RECORDS_PER_TURN === 0) await nextTurn();
    checkCancelled(signal);
  };
}

/** Checks before the hooks and again just before COMMIT, so a cancelled import rolls back whole. */
export function cancelBeforeCommit(ctx: OperationContext<EntryRepositories>, signal: AbortSignal | undefined): void {
  if (!signal) return;
  checkCancelled(signal);
  ctx.readAtCommit(async () => checkCancelled(signal));
}

/** Failures that end the whole import: a cancellation, the deadline, a work limit, or a transaction to rerun. */
function endsImport(error: unknown): boolean {
  return (
    error instanceof RequestCancelled ||
    error instanceof ImportDeadlineExceeded ||
    isImportLimit(error) ||
    (error instanceof StorageConflict && ['serialization', 'deadlock', 'busy'].includes(error.kind))
  );
}

/** The message to report for a refused record; rethrows a failure that ends the import. */
export function importError(error: unknown, fallback: string): string {
  if (endsImport(error)) throw error;
  return error instanceof Error ? error.message : fallback;
}
