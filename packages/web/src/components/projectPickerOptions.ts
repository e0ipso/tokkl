import type { Project, Task } from '@tokkl/types';

interface PickerGroup {
  /** '' for projects without a client. */
  client: string;
  rows: Array<{ project: Project; tasks: Task[] }>;
}

interface PickerOption {
  projectId: number | null;
  taskId: number | null;
}

function projectMatches(project: Project, query: string): boolean {
  const q = query.toLowerCase();
  return project.name.toLowerCase().includes(q) || (project.client_name ?? '').toLowerCase().includes(q);
}

function taskMatches(task: Task, query: string): boolean {
  return task.name.toLowerCase().includes(query.toLowerCase());
}

/** Clientless projects first, then clients by name. A project shows when it, its client or an active task matches. */
export function groupPickerProjects(
  projects: readonly Project[],
  tasks: readonly Task[],
  query: string,
): PickerGroup[] {
  const activeTasksOf = (project: Project) => tasks.filter(task => task.project_id === project.id && task.active);
  const groups = new Map<string, PickerGroup['rows']>();
  for (const project of projects) {
    if (!project.active) continue;
    const own = activeTasksOf(project);
    const whole = query === '' || projectMatches(project, query);
    if (!whole && !own.some(task => taskMatches(task, query))) continue;
    const client = project.client_name ?? '';
    const row = { project, tasks: whole ? own : own.filter(task => taskMatches(task, query)) };
    groups.set(client, [...(groups.get(client) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([client, rows]) => ({ client, rows }));
}

/** An option's index is its id. "No project" leads an empty search. */
export function pickerOptions(groups: readonly PickerGroup[], query: string): PickerOption[] {
  const options: PickerOption[] = query === '' ? [{ projectId: null, taskId: null }] : [];
  for (const { rows } of groups) {
    for (const { project, tasks } of rows) {
      options.push({ projectId: project.id, taskId: null });
      for (const task of tasks) options.push({ projectId: project.id, taskId: task.id });
    }
  }
  return options;
}
