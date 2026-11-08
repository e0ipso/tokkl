/**
 * The time entry writes of one signed-in user. Each is one transaction on storage that checks the
 * credential around it, guards the user's timer, and publishes a changed timer after commit.
 */
import type { EntryChanges, EntryPatchStep, EntrySplit, NewEntry } from '../domain/entryCommands.ts';
import {
  createTimeEntry,
  deleteTimeEntry,
  patchTimeEntries,
  purgeDeletedEntries,
  restoreTimeEntry,
  splitTimeEntry,
  stopTimeEntry,
  updateTimeEntry,
  type SplitEntries,
} from '../domain/timeEntries.ts';
import { getTimeEntry, type EntryTransactions } from '../domain/entryAccess.ts';
import { idempotent } from '../domain/idempotency.ts';
import type { IdempotencyClaim } from '../lib/idempotency.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import type { EntryDetails, Id, User } from '../domain/model.ts';

/** `create` and `split` take an optional `Idempotency-Key` claim; see `domain/idempotency.ts`. */
export interface EntryOperations {
  create(wid: Id, entry: NewEntry, claim?: IdempotencyClaim): Promise<EntryDetails>;
  update(wid: Id, id: Id, changes: EntryChanges): Promise<EntryDetails>;
  /** Stops a running entry at `at`, or now. */
  stop(wid: Id, id: Id, at?: Date): Promise<EntryDetails>;
  /** Applies every step to each entry; a refused entry is listed under `failure`. */
  patch(
    wid: Id,
    ids: Id[],
    steps: EntryPatchStep[],
  ): Promise<{ success: Id[]; failure: Array<{ id: Id; message: string }> }>;
  /** Moves the entry to the trash. */
  remove(wid: Id, id: Id): Promise<void>;
  /** Takes an entry out of the trash. */
  restore(id: Id): Promise<EntryDetails>;
  /** Deletes trashed entries for good: the one with `id`, or all of them. Answers how many. */
  purgeTrash(id?: Id): Promise<number>;
  /** Splits a stopped entry in two, both halves or neither. */
  split(id: Id, split: EntrySplit, claim?: IdempotencyClaim): Promise<SplitEntries>;
}

/** `storage` checks the user's credential around each transaction. */
export function createEntryOperations(
  storage: EntryTransactions,
  user: User,
  publish: TimerPublication,
): EntryOperations {
  return {
    create: (wid, entry, claim) =>
      storage.transaction(ctx =>
        idempotent(ctx, user.id, claim, {
          create: () => createTimeEntry(ctx, user, wid, entry, publish),
          reference: created => created.id,
          replay: id => getTimeEntry(ctx, user.id, id),
        }),
      ),
    update: (wid, id, changes) => storage.transaction(ctx => updateTimeEntry(ctx, user, wid, id, changes, publish)),
    stop: (wid, id, at) => storage.transaction(ctx => stopTimeEntry(ctx, user, wid, id, publish, at)),
    patch: (wid, ids, steps) => storage.transaction(ctx => patchTimeEntries(ctx, user, wid, ids, steps, publish)),
    remove: (wid, id) => storage.transaction(ctx => deleteTimeEntry(ctx, user.id, wid, id, publish)),
    restore: id => storage.transaction(ctx => restoreTimeEntry(ctx, user, id, publish)),
    purgeTrash: id => storage.transaction(ctx => purgeDeletedEntries(ctx, user.id, publish, id)),
    // The entry keeps the first half, so a repeat reads it and the second half it made.
    split: (id, split, claim) =>
      storage.transaction(ctx =>
        idempotent(ctx, user.id, claim, {
          create: () => splitTimeEntry(ctx, user, id, split, publish),
          reference: halves => halves.second.id,
          replay: async second => ({
            first: await getTimeEntry(ctx, user.id, id),
            second: await getTimeEntry(ctx, user.id, second),
          }),
        }),
      ),
  };
}
