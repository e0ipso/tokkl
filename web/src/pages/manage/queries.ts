import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { keys, useWid } from '../../api/hooks.ts';
import type { Task, TimeEntry } from '../../api/types.ts';
import { useToast } from '../../components/Toast.tsx';

export const V9 = '/api/v9';

/** Invalidates several query keys at once so every page that shows the data refetches it. */
export function useInvalidate(): (...queryKeys: readonly QueryKey[]) => Promise<void> {
  const qc = useQueryClient();
  return async (...queryKeys) => {
    await Promise.all(queryKeys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  };
}

/** Workspace-scoped path builder: `wsPath(wid, 'projects', 3)` gives `/api/v9/workspaces/{wid}/projects/3`. */
export function wsPath(wid: number, ...segments: Array<string | number>): string {
  return [`${V9}/workspaces/${wid}`, ...segments].join('/');
}

interface ActionOptions<TVars, TResult> {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Query keys to refresh after success. */
  invalidate?: readonly QueryKey[];
  /** Toast shown after success. */
  success?: string | ((result: TResult, vars: TVars) => string);
  onSuccess?: (result: TResult, vars: TVars) => void;
}

/**
 * A mutation that refreshes the given queries, shows a success toast and reports server errors
 * through `toast.error`, so callers only describe what the action does.
 */
export function useAction<TVars = void, TResult = unknown>(options: ActionOptions<TVars, TResult>) {
  const toast = useToast();
  const invalidate = useInvalidate();
  return useMutation<TResult, Error, TVars>({
    mutationFn: options.mutationFn,
    onSuccess: (result, vars) => {
      void invalidate(...(options.invalidate ?? []));
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast.show(message);
      options.onSuccess?.(result, vars);
    },
    onError: (error) => toast.error(error),
  });
}

/**
 * Tasks of one project, archived ones included. The key starts with `keys.tasks`, so invalidating
 * `keys.tasks` refreshes it too.
 */
export function useProjectTasks(projectId: number | null) {
  const wid = useWid();
  return useQuery({
    queryKey: [...keys.tasks, 'project', projectId],
    queryFn: () => api.get<Task[]>(`${wsPath(wid, 'projects', projectId ?? 0, 'tasks')}?active=both`),
    enabled: wid > 0 && projectId !== null,
  });
}

/** Toggl reports `tracked_seconds` in milliseconds despite the name; the server copies that quirk. */
export function taskTrackedSeconds(task: Task): number {
  return Math.floor(task.tracked_seconds / 1000);
}

/** Deleted entries, newest deletion first. The server returns at most 1000. */
export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: () => api.get<TimeEntry[]>('/api/app/trash'),
  });
}

/** Parses an optional non-negative number field. Empty means null; anything invalid means undefined. */
export function parseOptionalAmount(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function includesText(haystack: string | null | undefined, query: string): boolean {
  return (haystack ?? '').toLowerCase().includes(query.trim().toLowerCase());
}
