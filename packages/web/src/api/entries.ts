import { useMemo } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { list, object } from './decode.ts';
import { coversPreviousRange } from './entriesPlaceholder.ts';
import { postCreate } from './idempotency.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { APP, V9, wsPath } from './paths.ts';
import { attemptTimerRequest, editRunningEntry, timerWrite, type RunningEntryChanges } from './timerHooks.ts';
import { MOVES_TIMER } from './timerState.ts';
import type {
  BulkPatchResult,
  EntryBounds,
  PatchOperation,
  TimeEntry,
  TimeEntryInput,
  TimerState,
  TrashTotal,
} from '@tokkl/types';

/** Time entries: lists, writes and the trash. The running entry comes from the timer state (timerHooks.ts). */

/**
 * Entries that started from startDate to endDate, both "YYYY-MM-DD" in the account timezone. When
 * the range grows to cover the one shown before ("Show more days"), the previous rows stay as
 * placeholder data until the wider range arrives, so the list keeps its place. Any other range
 * change starts empty: rows from a range the new one does not cover are never shown in its place.
 */
export function useEntries(startDate: string, endDate: string) {
  return useQuery({
    queryKey: [...keys.entries, startDate, endDate],
    queryFn: ({ signal }) => entryRequests.list(startDate, endDate, signal),
    refetchInterval: 60_000,
    placeholderData: (previous, previousQuery) =>
      coversPreviousRange(previousQuery?.queryKey, startDate, endDate) ? previous : undefined,
  });
}

export function useEntryBounds() {
  return useQuery({
    queryKey: [...keys.report, 'bounds'],
    queryFn: ({ signal }) => api.get<EntryBounds>(`${APP}/bounds`, { signal, decode: object }),
    refetchInterval: 60_000,
  });
}

/** Deleted entries, newest deletion first. The server lists at most `limit` of them (`useTrashTotal`). */
export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: ({ signal }) => api.get<TimeEntry[]>(`${APP}/trash`, { signal, decode: list }),
  });
}

/**
 * How many entries the trash holds (`total`) and how many of the newest the trash list shows at
 * most (`limit`). Its key sits under `keys.trash`, so whatever refreshes the trash refreshes it.
 */
export const trashTotalOptions = queryOptions({
  queryKey: [...keys.trash, 'total'],
  queryFn: ({ signal }) => api.get<TrashTotal>(`${APP}/trash/total`, { signal, decode: object }),
});

export function useTrashTotal() {
  return useQuery(trashTotalOptions);
}

/**
 * Entry reads and writes outside the hooks below, such as opening one entry from a report row. A
 * create carries an `Idempotency-Key` (`postCreate` in idempotency.ts).
 */
export const entryRequests = {
  /** Entries that started from startDate to endDate, both "YYYY-MM-DD" in the account timezone. */
  list: (startDate: string, endDate: string, signal?: AbortSignal) =>
    api.get<TimeEntry[]>(`${V9}/me/time_entries?start_date=${startDate}&end_date=${endDate}&meta=true`, {
      signal,
      decode: list,
    }),
  get: (id: number) => api.get<TimeEntry>(`${V9}/me/time_entries/${id}?meta=true`, { decode: object }),
  create: (wid: number, input: TimeEntryInput) =>
    postCreate<TimeEntry>(
      `${wsPath(wid, 'time_entries')}?meta=true`,
      { created_with: 'tokkl-web', ...input },
      { decode: object },
    ),
  /** Saves an edit. The views refetch the entry rather than read the reply. */
  update: (wid: number, id: number, input: TimeEntryInput) =>
    api.put(`${wsPath(wid, 'time_entries', id)}?meta=true`, input),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'time_entries', id)),
  /** Deletes a trashed entry for good. */
  purge: (id: number) => api.delete(`${APP}/trash/${id}`),
  emptyTrash: () => api.delete<{ deleted: number }>(`${APP}/trash`, undefined, { decode: object }),
};

function useInvalidateEntries() {
  const qc = useQueryClient();
  return () => invalidate(qc, stale.entries);
}

export function useCreateEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: (input: TimeEntryInput) => entryRequests.create(wid, input),
    onSuccess,
  });
}

/** An edit of one entry: its id and the fields that change. */
export type EntryUpdate = TimeEntryInput & { id: number };

/**
 * The mutation scope of writes to entry `id`. TanStack sends the writes in one scope one at a time,
 * in the order made, as it does preference saves, so two quick edits of one entry cannot land out
 * of order. Edits of different entries still go out together.
 */
export const entryScope = (id: number) => ({ id: `entry:${id}` });

/**
 * Runs `write` as a mutation in entry `id`'s scope (`entryScope`). A scope is fixed per mutation,
 * so each edit builds its own mutation instead of sharing one `useMutation`.
 */
function inEntryScope<T>(qc: QueryClient, id: number, write: () => Promise<T>, onSuccess?: () => unknown): Promise<T> {
  return qc
    .getMutationCache()
    .build(qc, { meta: MOVES_TIMER, scope: entryScope(id), mutationFn: write, onSuccess })
    .execute(undefined);
}

/**
 * Sends an edit of entry `update.id` as a v9 update, in that entry's scope (`entryScope`). Edits of
 * stopped entries go this way; edits of the running entry go through the timer
 * (`updateRunningEntry`).
 */
export function updateEntry(qc: QueryClient, wid: number, { id, ...input }: EntryUpdate): Promise<void> {
  return inEntryScope(
    qc,
    id,
    () => entryRequests.update(wid, id, input),
    () => invalidate(qc, stale.entries),
  );
}

/** An edit of the running entry: its id, which picks the scope, and the fields that change. */
export type RunningEntryUpdate = RunningEntryChanges & { id: number };

/**
 * Sends an edit of the running entry through the timer (`editRunningEntry` in timerHooks.ts),
 * naming the entry, in the entry's scope, so it stays in order with the other edits of it. The
 * reply is the new timer state, and a conflict, once the entry stopped, hands over the server's.
 */
export function updateRunningEntry(qc: QueryClient, { id, ...changes }: RunningEntryUpdate): Promise<TimerState> {
  return inEntryScope(qc, id, () => editRunningEntry(qc, id, changes));
}

/** What the entry edit hooks return: `mutate` reports a failure to `onError` only. */
export interface EntryUpdater<Update = EntryUpdate, Reply = void> {
  mutate(update: Update, options?: { onError?: (error: Error) => void }): void;
  mutateAsync(update: Update): Promise<Reply>;
}

function updaterOf<Update, Reply>(mutateAsync: (update: Update) => Promise<Reply>): EntryUpdater<Update, Reply> {
  return {
    mutateAsync,
    mutate: (update, options) =>
      void mutateAsync(update).catch((error: unknown) =>
        options?.onError?.(error instanceof Error ? error : new Error(String(error))),
      ),
  };
}

/** Saves an edit of an entry, in order with the other edits of that entry (`updateEntry`). */
export function useUpdateEntry(): EntryUpdater {
  const qc = useQueryClient();
  const wid = useWid();
  return useMemo(() => updaterOf((update: EntryUpdate) => updateEntry(qc, wid, update)), [qc, wid]);
}

/** Saves an edit of the running entry, in order with the other edits of it (`updateRunningEntry`). */
export function useUpdateRunningEntry(): EntryUpdater<RunningEntryUpdate, TimerState> {
  const qc = useQueryClient();
  return useMemo(() => updaterOf((update: RunningEntryUpdate) => updateRunningEntry(qc, update)), [qc]);
}

/** A finished entry typed into the idle timer bar: the draft's fields and the span it covers. */
export type TypedEntryInput = TimeEntryInput & { start: string; stop: string };

/**
 * Saves the finished entry typed into the idle timer bar as a duration, as a timer write
 * (`attemptTimerRequest`). Like the timer actions it is tried at once even offline
 * (`networkMode: 'always'`), so it never goes out later with the time of the click; other creates
 * use `useCreateEntry`, which waits for the connection. A create whose reply was lost goes out
 * again with its `Idempotency-Key` (idempotency.ts), so it is stored once. Start and Stop are timer
 * actions (`useStartTimer` and `useStopTimer` in timerHooks.ts).
 */
export function useAddTypedEntry() {
  const qc = useQueryClient();
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    networkMode: 'always',
    meta: MOVES_TIMER,
    mutationFn: (input: TypedEntryInput) => attemptTimerRequest(qc, () => entryRequests.create(wid, input)),
    onSuccess,
  });
}

export function useDeleteEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({ meta: MOVES_TIMER, mutationFn: (id: number) => entryRequests.remove(wid, id), onSuccess });
}

/** Discards the running entry: a v9 delete sent as a timer write (`timerWrite` in timerHooks.ts). */
export function useDiscardRunningEntry() {
  const qc = useQueryClient();
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: (id: number) => timerWrite(qc, () => entryRequests.remove(wid, id)),
    onSuccess,
  });
}

export function useRestoreEntry() {
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: (id: number) => api.post(`${APP}/time_entries/${id}/restore`),
    onSuccess,
  });
}

/** Edits several entries at once. The reply lists the ids that failed and why. */
export function useBulkPatch() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: ({ ids, operations }: { ids: number[]; operations: PatchOperation[] }) =>
      api.patch<BulkPatchResult>(wsPath(wid, 'time_entries', ids.join(',')), operations, { decode: object }),
    onSuccess,
  });
}

/** Where a stopped entry splits: the stored halves, as `snappedSplit` gives them. */
export interface SplitSpans {
  first: { start: Date; stop: Date };
  second: { start: Date; stop: Date };
}

/**
 * Splits a stopped entry in two at the halves' shared boundary. The server cuts the entry's
 * snapped span there and writes both halves in one transaction, so a failed split changes nothing.
 * It carries an `Idempotency-Key` (`postCreate`), so a split whose reply was lost is not made
 * twice. The halves show through the refetch, not the reply.
 */
export function useSplitEntry() {
  const onSettled = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: ({ entry, halves }: { entry: TimeEntry; halves: SplitSpans }) =>
      postCreate(`${APP}/time_entries/${entry.id}/split`, {
        at: halves.second.start.toISOString(),
        created_with: 'tokkl-web',
      }),
    onSettled,
  });
}
