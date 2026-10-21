import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { coversPreviousRange } from './entriesPlaceholder.ts';
import type {
  Client, Me, Preferences, Project, Report, ReportQuery, Tag, Task, TimeEntry, TimeEntryInput, Workspace,
} from './types.ts';

const v9 = '/api/v9';

export const keys = {
  me: ['me'] as const,
  preferences: ['preferences'] as const,
  workspace: ['workspace'] as const,
  projects: ['projects'] as const,
  clients: ['clients'] as const,
  tags: ['tags'] as const,
  tasks: ['tasks'] as const,
  entries: ['entries'] as const,
  current: ['current'] as const,
  report: ['report'] as const,
  trash: ['trash'] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>(`${v9}/me`), staleTime: 60_000 });
}

/** The account's workspace id. Only call below the auth gate, where /me has loaded. */
export function useWid(): number {
  const { data } = useMe();
  return data?.default_workspace_id ?? 0;
}

export function usePreferences() {
  return useQuery({ queryKey: keys.preferences, queryFn: () => api.get<Preferences>(`${v9}/me/preferences`), staleTime: 60_000 });
}

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    // The Pomodoro waits for this save to settle before it trusts an optimistic switch-off.
    mutationKey: keys.preferences,
    mutationFn: (changes: Partial<Preferences>) => api.post<Preferences>(`${v9}/me/preferences`, changes),
    onMutate: (changes) => {
      const previous = qc.getQueryData<Preferences>(keys.preferences);
      if (previous) qc.setQueryData(keys.preferences, { ...previous, ...changes });
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) qc.setQueryData(keys.preferences, context.previous);
    },
    onSuccess: (data) => qc.setQueryData(keys.preferences, data),
  });
}

export function useWorkspace() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.workspace,
    queryFn: () => api.get<Workspace>(`${v9}/workspaces/${wid}`),
    enabled: wid > 0,
    staleTime: 60_000,
  });
}

export function useProjects() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => api.get<Project[]>(`${v9}/workspaces/${wid}/projects?active=both`),
    enabled: wid > 0,
  });
}

export function useClients() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.clients,
    queryFn: () => api.get<Client[]>(`${v9}/workspaces/${wid}/clients?status=both`),
    enabled: wid > 0,
  });
}

export function useTags() {
  const wid = useWid();
  return useQuery({ queryKey: keys.tags, queryFn: () => api.get<Tag[]>(`${v9}/workspaces/${wid}/tags`), enabled: wid > 0 });
}

export function useTasks() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tasks,
    queryFn: () => api.get<Task[]>(`${v9}/me/tasks?include_not_active=true`),
    enabled: wid > 0,
  });
}

/** Entries that started in [startDate, endDate), both "YYYY-MM-DD" in the account timezone. */
/**
 * Entries from startDate to endDate. When the range grows to cover the one shown before ("Show more
 * days"), the previous rows stay as placeholder data until the wider range arrives, so the list keeps
 * its place. Any other range change starts empty: rows from a range the new one does not cover are
 * never shown in its place.
 */
export function useEntries(startDate: string, endDate: string) {
  return useQuery({
    queryKey: [...keys.entries, startDate, endDate],
    queryFn: () => api.get<TimeEntry[]>(`${v9}/me/time_entries?start_date=${startDate}&end_date=${endDate}&meta=true`),
    refetchInterval: 60_000,
    placeholderData: (previous, previousQuery) =>
      coversPreviousRange(previousQuery?.queryKey, startDate, endDate) ? previous : undefined,
  });
}

export function useCurrentEntry() {
  return useQuery({
    queryKey: keys.current,
    queryFn: () => api.get<TimeEntry | null>(`${v9}/me/time_entries/current?meta=true`),
    refetchInterval: 30_000,
  });
}

export function useEntryBounds() {
  return useQuery({
    queryKey: [...keys.report, 'bounds'],
    queryFn: () => api.get<{ first_date: string | null; last_date: string | null }>('/api/app/bounds'),
    refetchInterval: 60_000,
  });
}

export function useReport(query: ReportQuery | null) {
  return useQuery({
    queryKey: [...keys.report, query],
    queryFn: () => api.post<Report>('/api/app/report', query),
    enabled: query !== null,
    placeholderData: (previous) => previous,
    // The summary and the other tabs ask for different groupings; going back to the summary
    // reuses its result instead of refetching it. Edits invalidate keys.report anyway.
    staleTime: 60_000,
  });
}

function useInvalidateEntries() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.entries }),
    qc.invalidateQueries({ queryKey: keys.current }),
    qc.invalidateQueries({ queryKey: keys.report }),
    qc.invalidateQueries({ queryKey: keys.projects }),
    qc.invalidateQueries({ queryKey: keys.tags }),
    qc.invalidateQueries({ queryKey: keys.trash }),
  ]);
}

export function useCreateEntry() {
  const wid = useWid();
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (input: TimeEntryInput) =>
      api.post<TimeEntry>(`${v9}/workspaces/${wid}/time_entries?meta=true`, { created_with: 'tokkl-web', ...input }),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry() {
  const wid = useWid();
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: ({ id, ...input }: TimeEntryInput & { id: number }) =>
      api.put<TimeEntry>(`${v9}/workspaces/${wid}/time_entries/${id}?meta=true`, input),
    onSuccess: invalidate,
  });
}

export function useStopEntry() {
  const wid = useWid();
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (input: number | { id: number; stop: string }) => {
      const id = typeof input === 'number' ? input : input.id;
      return api.patch<TimeEntry>(`${v9}/workspaces/${wid}/time_entries/${id}/stop?meta=true`,
        typeof input === 'number' ? undefined : { stop: input.stop });
    },
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const wid = useWid();
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (id: number) => api.delete<null>(`${v9}/workspaces/${wid}/time_entries/${id}`),
    onSuccess: invalidate,
  });
}

export function useRestoreEntry() {
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: (id: number) => api.post<TimeEntry>(`/api/app/time_entries/${id}/restore`),
    onSuccess: invalidate,
  });
}

export interface PatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

export function useBulkPatch() {
  const wid = useWid();
  const invalidate = useInvalidateEntries();
  return useMutation({
    mutationFn: ({ ids, operations }: { ids: number[]; operations: PatchOperation[] }) =>
      api.patch<{ success: number[]; failure: Array<{ id: number; message: string }> }>(
        `${v9}/workspaces/${wid}/time_entries/${ids.join(',')}`, operations),
    onSuccess: invalidate,
  });
}

export function useCreateProject() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Project> & { name: string }) => api.post<Project>(`${v9}/workspaces/${wid}/projects`, input),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: keys.projects }),
      qc.invalidateQueries({ queryKey: keys.clients }),
    ]),
  });
}

export function useCreateTag() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Tag>(`${v9}/workspaces/${wid}/tags`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}
