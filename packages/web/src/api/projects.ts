import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWid } from './account.ts';
import { api } from './client.ts';
import { ignoreReply } from './decode.ts';
import { postCreate } from './idempotency.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { V9, wsPath } from './paths.ts';
import { projectListReply, projectReply, taskListReply, taskReply } from './replies.ts';
import type { Project, Task } from '@tokkl/types';

/** Projects and their tasks. */

export function useProjects() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.projects,
    queryFn: ({ signal }) => api.get(`${wsPath(wid, 'projects')}?active=both`, { signal, decode: projectListReply }),
    enabled: wid > 0,
  });
}

/** Every task the account can see, archived ones included. */
export function useTasks() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.tasks,
    queryFn: ({ signal }) => api.get(`${V9}/me/tasks?include_not_active=true`, { signal, decode: taskListReply }),
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
    queryFn: ({ signal }) =>
      api.get(`${wsPath(wid, 'projects', projectId ?? 0, 'tasks')}?active=both`, { signal, decode: taskListReply }),
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

/**
 * Project and task writes. Pass them to a mutation together with the matching `stale` list. A
 * create carries an `Idempotency-Key` (`postCreate` in idempotency.ts).
 */
export const projectRequests = {
  create: (wid: number, body: Partial<Project> & { name: string }) =>
    postCreate(wsPath(wid, 'projects'), body, { decode: projectReply }),
  update: (wid: number, id: number, body: Partial<ProjectBody> & { active?: boolean }) =>
    api.put(wsPath(wid, 'projects', id), body, { decode: projectReply }),
  remove: (wid: number, id: number, mode: ProjectDeletionMode) =>
    api.delete(`${wsPath(wid, 'projects', id)}?teDeletionMode=${mode}`, undefined, { decode: ignoreReply }),
  createTask: (wid: number, projectId: number, name: string) =>
    postCreate(wsPath(wid, 'projects', projectId, 'tasks'), { name }, { decode: ignoreReply }),
  updateTask: (wid: number, projectId: number, id: number, changes: Partial<Pick<Task, 'name' | 'active'>>) =>
    api.put(wsPath(wid, 'projects', projectId, 'tasks', id), changes, { decode: taskReply }),
  removeTask: (wid: number, projectId: number, id: number) =>
    api.delete(wsPath(wid, 'projects', projectId, 'tasks', id), undefined, { decode: ignoreReply }),
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
