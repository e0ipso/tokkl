/** Writing imported entries with their exact times, one savepoint per record. */
import type { Id } from './model.ts';
import { memoizeAsync } from '../lib/boundedCache.ts';
import { protectEntryOperation, type EntryContext } from './entryAccess.ts';
import type { NewEntry } from './entryCommands.ts';
import { entryReferences, type EntryReferences } from './entryReferences.ts';
import { memberWorkspace } from './membership.ts';
import { touchTimer, type TimerPublication } from './timerSettlement.ts';
import { prepareEntry } from './timeEntries.ts';

/** Reference lookups an import remembers; a failed row's savepoint clears them all. */
const IMPORT_REFERENCE_CACHE = 256;

export interface ExactEntryImport {
  /** Each record keeps its database writes, hooks and reference cache rollback-owned. */
  savepoint<T>(work: () => Promise<T>): Promise<T>;
  create(entry: NewEntry): Promise<void>;
}

function cachedReferences(ctx: EntryContext) {
  const original = entryReferences(ctx);
  const cached = {
    project: memoizeAsync(original.project, IMPORT_REFERENCE_CACHE),
    task: memoizeAsync(original.task, IMPORT_REFERENCE_CACHE),
    tags: memoizeAsync(original.tags, IMPORT_REFERENCE_CACHE),
    tagNames: memoizeAsync(original.tagNames, IMPORT_REFERENCE_CACHE),
  };
  const refs: EntryReferences = cached;
  return { refs, clear: () => Object.values(cached).forEach(lookup => lookup.clear()) };
}

/** Callback-scoped import capability in the caller's transaction. All reads and writes use this guarded context. */
export async function withExactEntryImport<T>(
  ctx: EntryContext,
  userId: Id,
  wid: Id,
  publish: TimerPublication,
  work: (writer: ExactEntryImport) => Promise<T>,
): Promise<T> {
  const user = await protectEntryOperation(ctx, userId, [wid]);
  await memberWorkspace(ctx, user.id, wid);
  let active = true,
    rowActive = false;
  const { refs, clear } = cachedReferences(ctx);
  function check() {
    if (!active) throw new Error('Entry import scope is closed');
  }
  const writer: ExactEntryImport = {
    async savepoint(unit) {
      check();
      if (rowActive) throw new Error('Import rows must be sequential');
      rowActive = true;
      try {
        return await ctx.savepoint(() => unit());
      } catch (error) {
        clear();
        throw error;
      } finally {
        rowActive = false;
      }
    },
    async create(entry) {
      check();
      if (!rowActive) throw new Error('Entry import requires a row savepoint');
      const input = await prepareEntry(ctx, user, wid, entry, true, refs);
      if (!input.stop && (await ctx.entries.running(userId)))
        throw new Error('Another timer is running here. Stop it and restore again to import this running entry');
      touchTimer(ctx, userId, publish);
      await ctx.entries.insert(input);
    },
  };
  try {
    return await work(writer);
  } finally {
    active = false;
    clear();
  }
}
