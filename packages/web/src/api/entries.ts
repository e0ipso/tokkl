import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { coversPreviousRange } from './entriesPlaceholder.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { APP, V9, wsPath } from './paths.ts';
import { entryBoundsReply, entryListReply, runningEntryReply, timeEntryReply } from './replies.ts';
import { useTimerStreaming } from './timerStreaming.ts';
import type { BulkPatchResult, PatchOperation, TimeEntry, TimeEntryInput } from './types.ts';

/** Time entries: lists, the running entry, writes and the trash. */

/**
 * Entries that started from startDate to endDate, both "YYYY-MM-DD" in the account timezone. When
 * the range grows to cover the one shown before ("Show more days"), the previous rows stay as
 * placeholder data until the wider range arrives, so the list keeps its place. Any other range
 * change starts empty: rows from a range the new one does not cover are never shown in its place.
 */
export function useEntries(startDate: string, endDate: string) {
  return useQuery({
    queryKey: [...keys.entries, startDate, endDate],
    queryFn: () =>
      api.get(`${V9}/me/time_entries?start_date=${startDate}&end_date=${endDate}&meta=true`, {
        decode: entryListReply,
      }),
    refetchInterval: 60_000,
    placeholderData: (previous, previousQuery) =>
      coversPreviousRange(previousQuery?.queryKey, startDate, endDate) ? previous : undefined,
  });
}

/** The running entry. While the timer stream is up it is written from each state, so it does not poll. */
export function useCurrentEntry() {
  const streaming = useTimerStreaming();
  return useQuery({
    queryKey: keys.current,
    queryFn: () => api.get(`${V9}/me/time_entries/current?meta=true`, { decode: runningEntryReply }),
    refetchInterval: streaming ? false : 30_000,
  });
}

export function useEntryBounds() {
  return useQuery({
    queryKey: [...keys.report, 'bounds'],
    queryFn: () => api.get(`${APP}/bounds`, { decode: entryBoundsReply }),
    refetchInterval: 60_000,
  });
}

/** Deleted entries, newest deletion first. The server returns at most 1000. */
export function useTrash() {
  return useQuery({ queryKey: keys.trash, queryFn: () => api.get(`${APP}/trash`, { decode: entryListReply }) });
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
  return useMutation({ mutationFn: (input: TimeEntryInput) => entryRequests.create(wid, input), onSuccess });
}

export function useUpdateEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    mutationFn: ({ id, ...input }: TimeEntryInput & { id: number }) => entryRequests.update(wid, id, input),
    onSuccess,
  });
}

export function useStopEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
    mutationFn: (input: number | { id: number; stop: string }) => {
      const id = typeof input === 'number' ? input : input.id;
      return api.patch<TimeEntry>(
        `${wsPath(wid, 'time_entries', id, 'stop')}?meta=true`,
        typeof input === 'number' ? undefined : { stop: input.stop },
      );
    },
    onSuccess,
  });
}

export function useDeleteEntry() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({ mutationFn: (id: number) => entryRequests.remove(wid, id), onSuccess });
}

export function useRestoreEntry() {
  const onSuccess = useInvalidateEntries();
  return useMutation({
    mutationFn: (id: number) => api.post<TimeEntry>(`${APP}/time_entries/${id}/restore`),
    onSuccess,
  });
}

/** Edits several entries at once. The reply lists the ids that failed and why. */
export function useBulkPatch() {
  const wid = useWid();
  const onSuccess = useInvalidateEntries();
  return useMutation({
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
 * Splits a stopped entry in two. The server has no split, so this creates the second half first;
 * if shortening the original then fails, it deletes the new half again, so a failed split leaves
 * the original as it was.
 */
export function useSplitEntry() {
  const wid = useWid();
  const onSettled = useInvalidateEntries();
  return useMutation({
    mutationFn: async ({ entry, halves }: { entry: TimeEntry; halves: SplitSpans }) => {
      const { description, project_id, task_id, tags, billable } = entry;
      const created = await entryRequests.create(wid, {
        description,
        project_id,
        task_id,
        tags,
        billable,
        start: halves.second.start.toISOString(),
        stop: halves.second.stop.toISOString(),
      });
      try {
        await entryRequests.update(wid, entry.id, {
          start: halves.first.start.toISOString(),
          stop: halves.first.stop.toISOString(),
        });
      } catch (error) {
        await entryRequests.remove(wid, created.id).catch(() => undefined);
        throw error;
      }
      return created;
    },
    onSettled,
  });
}
