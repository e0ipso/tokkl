import { useMemo } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { list, object } from './decode.ts';
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

/** A range that grows over the previous one keeps its rows as placeholder; any other change starts empty. */
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

/** Newest deletion first; the server lists at most `limit` (`useTrashTotal`). */
export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: ({ signal }) => api.get<TimeEntry[]>(`${APP}/trash`, { signal, decode: list }),
  });
}

/** `total` in the trash and the list's `limit`. Keyed under `keys.trash`, so trash refreshes reach it. */
export const trashTotalOptions = queryOptions({
  queryKey: [...keys.trash, 'total'],
  queryFn: ({ signal }) => api.get<TrashTotal>(`${APP}/trash/total`, { signal, decode: object }),
});

export function useTrashTotal() {
  return useQuery(trashTotalOptions);
}

/** Reads and writes outside the hooks below, such as opening an entry from a report row. */
export const entryRequests = {
  /** Both "YYYY-MM-DD" in the account timezone. */
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
  /** The views refetch the entry rather than read the reply. */
  update: (wid: number, id: number, input: TimeEntryInput) =>
    api.put(`${wsPath(wid, 'time_entries', id)}?meta=true`, input),
  remove: (wid: number, id: number) => api.delete(wsPath(wid, 'time_entries', id)),
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

type EntryUpdate = TimeEntryInput & { id: number };

/** TanStack runs one scope's writes one at a time in order, so quick edits of one entry cannot land out of order. */
export const entryScope = (id: number) => ({ id: `entry:${id}` });

/** A scope is fixed per mutation, so each edit builds its own mutation. */
function inEntryScope<T>(qc: QueryClient, id: number, write: () => Promise<T>, onSuccess?: () => unknown): Promise<T> {
  return qc
    .getMutationCache()
    .build(qc, { meta: MOVES_TIMER, scope: entryScope(id), mutationFn: write, onSuccess })
    .execute(undefined);
}

/** For stopped entries; the running entry goes through `updateRunningEntry`. */
export function updateEntry(qc: QueryClient, wid: number, { id, ...input }: EntryUpdate): Promise<void> {
  return inEntryScope(
    qc,
    id,
    () => entryRequests.update(wid, id, input),
    () => invalidate(qc, stale.entries),
  );
}

type RunningEntryUpdate = RunningEntryChanges & { id: number };

/** Through the timer, naming the entry, in its scope. Once the entry stopped, a conflict hands over the state. */
export function updateRunningEntry(qc: QueryClient, { id, ...changes }: RunningEntryUpdate): Promise<TimerState> {
  return inEntryScope(qc, id, () => editRunningEntry(qc, id, changes));
}

/** `mutate` reports a failure to `onError` only. */
interface EntryUpdater<Update = EntryUpdate, Reply = void> {
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

export function useUpdateEntry(): EntryUpdater {
  const qc = useQueryClient();
  const wid = useWid();
  return useMemo(() => updaterOf((update: EntryUpdate) => updateEntry(qc, wid, update)), [qc, wid]);
}

export function useUpdateRunningEntry(): EntryUpdater<RunningEntryUpdate, TimerState> {
  const qc = useQueryClient();
  return useMemo(() => updaterOf((update: RunningEntryUpdate) => updateRunningEntry(qc, update)), [qc]);
}

type TypedEntryInput = TimeEntryInput & { start: string; stop: string };

/** A timer write tried at once even offline, so it never goes out later with the click's time; retried with its key. */
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

/** A v9 delete sent as a timer write. */
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

/** The reply lists the ids that failed and why. */
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

/** As `snappedSplit` gives them. */
interface SplitSpans {
  first: { start: Date; stop: Date };
  second: { start: Date; stop: Date };
}

/** One server transaction, so a failed split changes nothing; its `Idempotency-Key` stops a lost reply doubling it. */
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

/** Only a range covering the previous one keeps its rows, so the list never shows entries outside its range. */
export function coversPreviousRange(
  previousKey: readonly unknown[] | undefined,
  startDate: string,
  endDate: string,
): boolean {
  const [, previousStart, previousEnd] = previousKey ?? [];
  return (
    typeof previousStart === 'string' &&
    typeof previousEnd === 'string' &&
    startDate <= previousStart &&
    endDate >= previousEnd
  );
}
