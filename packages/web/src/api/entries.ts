import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { coversPreviousRange } from './entriesPlaceholder.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { APP, V9, wsPath } from './paths.ts';
import { entryBoundsReply, entryListReply, timeEntryReply } from './replies.ts';
import { attemptTimerRequest, timerWrite } from './timerHooks.ts';
import { MOVES_TIMER } from './timerState.ts';
import type { BulkPatchResult, PatchOperation, TimeEntry, TimeEntryInput } from './types.ts';

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
    queryFn: ({ signal }) =>
      api.get(`${V9}/me/time_entries?start_date=${startDate}&end_date=${endDate}&meta=true`, {
        signal,
        decode: entryListReply,
      }),
    refetchInterval: 60_000,
    placeholderData: (previous, previousQuery) =>
      coversPreviousRange(previousQuery?.queryKey, startDate, endDate) ? previous : undefined,
  });
}

export function useEntryBounds() {
  return useQuery({
    queryKey: [...keys.report, 'bounds'],
    queryFn: ({ signal }) => api.get(`${APP}/bounds`, { signal, decode: entryBoundsReply }),
    refetchInterval: 60_000,
  });
}

/** Deleted entries, newest deletion first. The server returns at most 1000. */
export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: ({ signal }) => api.get(`${APP}/trash`, { signal, decode: entryListReply }),
  });
}

/** Entry reads and writes outside the hooks below, such as opening one entry from a report row. */
export const entryRequests = {
  get: (id: number) => api.get(`${V9}/me/time_entries/${id}?meta=true`, { decode: timeEntryReply }),
  create: (wid: number, input: TimeEntryInput) =>
    api.post<TimeEntry>(`${wsPath(wid, 'time_entries')}?meta=true`, { created_with: 'tokkl-web', ...input }),
  update: (wid: number, id: number, input: TimeEntryInput) =>
    api.put<TimeEntry>(`${wsPath(wid, 'time_entries', id)}?meta=true`, input),
  remove: (wid: number, id: number) => api.delete<null>(wsPath(wid, 'time_entries', id)),
  /** Deletes a trashed entry for good. */
  purge: (id: number) => api.delete(`${APP}/trash/${id}`),
  emptyTrash: () => api.delete<{ deleted: number }>(`${APP}/trash`),
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

export function useUpdateEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: ({ id, ...input }: TimeEntryInput & { id: number }) => entryRequests.update(wid, id, input),
    onSuccess,
  });
}

/**
 * Saves an edit of the running entry. It is a timer write (`timerWrite` in timerHooks.ts): after
 * one whose outcome is unknown, the timer state is read before it goes out.
 */
export function useUpdateRunningEntry() {
  const qc = useQueryClient();
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: ({ id, ...input }: TimeEntryInput & { id: number }) =>
      timerWrite(qc, () => entryRequests.update(wid, id, input)),
    onSuccess,
  });
}

/**
 * Saves the finished entry typed into the idle timer bar as a duration. Like the timer actions it
 * is tried at once even offline (`networkMode: 'always'`), so it never goes out later with the time
 * of the click; other creates use `useCreateEntry`, which waits for the connection. Start and Stop
 * are timer actions (`useStartTimer` and `useStopTimer` in timerHooks.ts).
 */
export function useAddTypedEntry() {
  const qc = useQueryClient();
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    networkMode: 'always',
    meta: MOVES_TIMER,
    mutationFn: (input: TimeEntryInput) => attemptTimerRequest(qc, () => entryRequests.create(wid, input)),
    onSuccess,
  });
}

export function useDeleteEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({ meta: MOVES_TIMER, mutationFn: (id: number) => entryRequests.remove(wid, id), onSuccess });
}

/** Discards the running entry: a delete sent as a timer write, like `useUpdateRunningEntry`. */
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
    mutationFn: (id: number) => api.post<TimeEntry>(`${APP}/time_entries/${id}/restore`),
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
      api.patch<BulkPatchResult>(wsPath(wid, 'time_entries', ids.join(',')), operations),
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
 * Answers the new second half.
 */
export function useSplitEntry() {
  const onSettled = useInvalidateEntries();
  return useMutation({
    meta: MOVES_TIMER,
    mutationFn: async ({ entry, halves }: { entry: TimeEntry; halves: SplitSpans }) => {
      const { second } = await api.post<{ first: TimeEntry; second: TimeEntry }>(
        `${APP}/time_entries/${entry.id}/split`,
        { at: halves.second.start.toISOString(), created_with: 'tokkl-web' },
      );
      return second;
    },
    onSettled,
  });
}
