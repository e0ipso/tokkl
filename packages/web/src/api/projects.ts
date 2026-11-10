import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { list, object } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { V9, wsPath } from './paths.ts';
import type { Project, Task } from '@tokkl/types';

export function useProjects() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.projects,
    queryFn: ({ signal }) => api.get<Project[]>(`${wsPath(wid, 'projects')}?active=both`, { signal, decode: list }),
    enabled: wid > 0,
  });
}

/** Archived ones included. */
export function useTasks() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tasks,
    queryFn: ({ signal }) => api.get<Task[]>(`${V9}/me/tasks?include_not_active=true`, { signal, decode: list }),
    enabled: wid > 0,
  });
}

/** Archived ones included; keyed under `keys.tasks`. */
export function useProjectTasks(projectId: number | null) {
  const wid = useWid();
  return useQuery({
    queryKey: [...keys.tasks, 'project', projectId],
    queryFn: ({ signal }) =>
      api.get<Task[]>(`${wsPath(wid, 'projects', projectId ?? 0, 'tasks')}?active=both`, { signal, decode: list }),
    enabled: wid > 0 && projectId !== null,
  });
}

/** Toggl reports `tracked_seconds` in milliseconds despite the name; the server copies that quirk. */
export function taskTrackedSeconds(task: Task): number {
  return Math.floor(task.tracked_seconds / 1000);
}

export interface ProjectBody {
  name: string;
  color: string;
  /** 0 clears the client. The server ignores null here and keeps the current client. */
  client_id: number;
  billable: boolean;
  rate: number | null;
  currency: string | null;
  estimated_hours: number | null;
}

export type ProjectDeletionMode = 'unassign' | 'delete';

/** Pass them to a mutation with the matching `stale` list. Creates carry an `Idempotency-Key`. */
export const projectRequests = {
  create: (wid: number, body: Partial<Project> & { name: string }) =>
    postCreate<Project>(wsPath(wid, 'projects'), body, { decode: object }),
  update: (wid: number, id: number, body: Partial<ProjectBody> & { active?: boolean }) =>
    api.put<Project>(wsPath(wid, 'projects', id), body, { decode: object }),
  remove: (wid: number, id: number, mode: ProjectDeletionMode) =>
    api.delete(`${wsPath(wid, 'projects', id)}?teDeletionMode=${mode}`),
  createTask: (wid: number, projectId: number, name: string) =>
    postCreate(wsPath(wid, 'projects', projectId, 'tasks'), { name }),
  updateTask: (wid: number, projectId: number, id: number, changes: Partial<Pick<Task, 'name' | 'active'>>) =>
    api.put<Task>(wsPath(wid, 'projects', projectId, 'tasks', id), changes, { decode: object }),
  removeTask: (wid: number, projectId: number, id: number) =>
    api.delete(wsPath(wid, 'projects', projectId, 'tasks', id)),
};

/** No toast: the picker shows the new project picked. */
export function useCreateProject() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Project> & { name: string }) => projectRequests.create(wid, input),
    onSuccess: () => invalidate(qc, stale.projectCreated),
  });
}
