import type { CSSProperties } from 'react';
import { useProjects, useTasks } from '../api/projects.ts';
import { t } from '../i18n/messages.ts';

/** CSS derives dot, border and tint from --project-color (.project-dot in styles/entries.css); text never uses it. */
export function projectColorStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? { '--project-color': color } : undefined;
}

export function ProjectDot({ color }: { color: string | null | undefined }) {
  return <span className="project-dot" style={projectColorStyle(color)} />;
}

/** A deleted project comes from `fallback`. */
export function ProjectLabel({
  projectId,
  taskId,
  fallback,
}: {
  projectId: number | null;
  taskId?: number | null;
  fallback?: { name?: string | null; color?: string | null; client?: string | null; task?: string | null };
}) {
  const { data: projects } = useProjects();
  const { data: tasks } = useTasks();
  if (projectId === null) return null;
  const project = projects?.find(p => p.id === projectId);
  const task = taskId ? tasks?.find(t => t.id === taskId) : undefined;
  const name = project?.name ?? fallback?.name ?? t('entries.unknownProject');
  const color = project?.color ?? fallback?.color;
  const client = project?.client_name ?? fallback?.client;
  const taskName = task?.name ?? fallback?.task;
  return (
    <span className="project-label">
      <ProjectDot color={color} />
      <span className="project-label-name">
        {taskName ? t('entries.projectWithTask', { project: name, task: taskName }) : name}
      </span>
      {client ? <span className="project-label-client">{client}</span> : null}
    </span>
  );
}
