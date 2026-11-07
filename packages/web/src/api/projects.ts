import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { V9, wsPath } from './paths.ts';
import type { Project, Task } from './types.ts';

/** Projects and their tasks. */

export function useProjects() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => api.get<Project[]>(`${wsPath(wid, 'projects')}?active=both`),
    enabled: wid > 0,
  });
}

/** Every task the account can see, archived ones included. */
export function useTasks() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tasks,
    queryFn: () => api.get<Task[]>(`${V9}/me/tasks?include_not_active=true`),
    enabled: wid > 0,
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

/** The project fields the editor sends. */
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

/** What happens to a deleted project's entries: they lose the project, or go to the trash. */
export type ProjectDeletionMode = 'unassign' | 'delete';

/** Project and task writes. Pass them to a mutation together with the matching `stale` list. */
export const projectRequests = {
  create: (wid: number, body: Partial<Project> & { name: string }) => api.post<Project>(wsPath(wid, 'projects'), body),
  update: (wid: number, id: number, body: Partial<ProjectBody> & { active?: boolean }) =>
    api.put<Project>(wsPath(wid, 'projects', id), body),
  remove: (wid: number, id: number, mode: ProjectDeletionMode) =>
    api.delete(`${wsPath(wid, 'projects', id)}?teDeletionMode=${mode}`),
  createTask: (wid: number, projectId: number, name: string) =>
    api.post<Task>(wsPath(wid, 'projects', projectId, 'tasks'), { name }),
  updateTask: (wid: number, projectId: number, id: number, changes: Partial<Pick<Task, 'name' | 'active'>>) =>
    api.put<Task>(wsPath(wid, 'projects', projectId, 'tasks', id), changes),
  removeTask: (wid: number, projectId: number, id: number) =>
    api.delete<null>(wsPath(wid, 'projects', projectId, 'tasks', id)),
};

/** Creates a project from a picker, with no toast: the picker shows the new project picked. */
export function useCreateProject() {
  const wid = useWid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Project> & { name: string }) => projectRequests.create(wid, input),
    onSuccess: () => invalidate(qc, stale.projectCreated),
  });
}
