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
} from '../domain/timeEntries.ts';
import { getTimeEntry, type EntryTransactions } from '../domain/entryAccess.ts';
import { idempotent } from '../domain/idempotency.ts';
import type { IdempotencyClaim } from '../lib/idempotency.ts';
import type { TimerPublication } from '../domain/timerSettlement.ts';
import type { Id, User } from '../domain/model.ts';

/** `storage` checks the user's credential around each transaction. */
export function createEntryOperations(storage: EntryTransactions, user: User, publish: TimerPublication) {
  return {
    /** `create` and `split` take an optional `Idempotency-Key` claim; see `domain/idempotency.ts`. */
    create: (wid: Id, entry: NewEntry, claim?: IdempotencyClaim) =>
      storage.transaction(ctx =>
        idempotent(ctx, user.id, claim, {
          create: () => createTimeEntry(ctx, user, wid, entry, publish),
          reference: created => created.id,
          replay: id => getTimeEntry(ctx, user.id, id),
        }),
      ),
    update: (wid: Id, id: Id, changes: EntryChanges) =>
      storage.transaction(ctx => updateTimeEntry(ctx, user, wid, id, changes, publish)),
    stop: (wid: Id, id: Id, at?: Date) => storage.transaction(ctx => stopTimeEntry(ctx, user, wid, id, publish, at)),
    patch: (wid: Id, ids: Id[], steps: EntryPatchStep[]) =>
      storage.transaction(ctx => patchTimeEntries(ctx, user, wid, ids, steps, publish)),
    remove: (wid: Id, id: Id) => storage.transaction(ctx => deleteTimeEntry(ctx, user.id, wid, id, publish)),
    restore: (id: Id) => storage.transaction(ctx => restoreTimeEntry(ctx, user, id, publish)),
    purgeTrash: (id?: Id) => storage.transaction(ctx => purgeDeletedEntries(ctx, user.id, publish, id)),
    // The entry keeps the first half, so a repeat reads it and the second half it made.
    split: (id: Id, split: EntrySplit, claim?: IdempotencyClaim) =>
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
