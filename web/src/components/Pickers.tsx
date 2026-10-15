import { useMemo, useState, type CSSProperties } from 'react';
import { useCreateProject, useCreateTag, useProjects, useTags, useTasks } from '../api/hooks.ts';
import type { Project } from '../api/types.ts';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { useToast } from './Toast.tsx';

/**
 * Sets --project-color for the element. CSS derives the dot, border and tint from it (see
 * .project-dot in styles.css); text never takes the project colour.
 */
export function projectColorStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? { ['--project-color' as string]: color } : undefined;
}

export function ProjectDot({ color }: { color: string | null | undefined }) {
  return <span className="project-dot" style={projectColorStyle(color)} />;
}

export function ProjectLabel({ projectId, taskId, fallback }: {
  projectId: number | null;
  taskId?: number | null;
  fallback?: { name?: string | null; color?: string | null; client?: string | null; task?: string | null };
}) {
  const { data: projects } = useProjects();
  const { data: tasks } = useTasks();
  if (projectId === null) return null;
  const project = projects?.find((p) => p.id === projectId);
  const task = taskId ? tasks?.find((t) => t.id === taskId) : undefined;
  const name = project?.name ?? fallback?.name ?? 'Unknown project';
  const color = project?.color ?? fallback?.color;
  const client = project?.client_name ?? fallback?.client;
  const taskName = task?.name ?? fallback?.task;
  return (
    <span className="project-label">
      <ProjectDot color={color} />
      <span className="project-label-name">{name}{taskName ? `: ${taskName}` : ''}</span>
      {client ? <span className="project-label-client">{client}</span> : null}
    </span>
  );
}

function matches(project: Project, query: string): boolean {
  const q = query.toLowerCase();
  return project.name.toLowerCase().includes(q) || (project.client_name ?? '').toLowerCase().includes(q);
}

/** Project and task chooser with inline project creation (Ctrl/Cmd+Enter or the create row). */
export function ProjectPicker({ anchor, projectId, taskId, onChange, onClose }: {
  anchor: HTMLElement | null;
  projectId: number | null;
  taskId: number | null;
  onChange: (projectId: number | null, taskId: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const createProject = useCreateProject();
  const toast = useToast();

  const grouped = useMemo(() => {
    const visible = projects.filter((p) => p.active && (query === '' || matches(p, query)
      || tasks.some((t) => t.project_id === p.id && t.active && t.name.toLowerCase().includes(query.toLowerCase()))));
    const groups = new Map<string, Project[]>();
    for (const project of visible) {
      const key = project.client_name ?? '';
      groups.set(key, [...(groups.get(key) ?? []), project]);
    }
    return [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [projects, tasks, query]);

  const exact = projects.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());
  const create = async () => {
    const name = query.trim();
    if (!name || exact) return;
    try {
      const project = await createProject.mutateAsync({ name });
      onChange(project.id, null);
      onClose();
    } catch (error) {
      toast.error(error);
    }
  };
  const pick = (pid: number | null, tid: number | null) => {
    onChange(pid, tid);
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={320}>
      <input
        className="picker-search"
        autoFocus
        placeholder="Find or create project…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void create();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const first = grouped[0]?.[1][0];
            if (first) pick(first.id, null);
            else void create();
          }
        }}
      />
      <div className="picker-list" role="listbox" aria-label="Projects">
        {query === '' ? (
          <button
            type="button"
            role="option"
            aria-selected={projectId === null}
            className={`picker-item${projectId === null ? ' selected' : ''}`}
            onClick={() => pick(null, null)}
          >
            <ProjectDot color={null} /> No project
          </button>
        ) : null}
        {grouped.map(([client, list]) => (
          <div key={client || 'none'} role={client ? 'group' : 'none'} aria-label={client || undefined}>
            {client ? <div className="picker-group" aria-hidden="true">{client}</div> : null}
            {list.map((project) => {
              const projectTasks = tasks.filter((t) => t.project_id === project.id && t.active
                && (query === '' || matches(project, query) || t.name.toLowerCase().includes(query.toLowerCase())));
              const projectSelected = projectId === project.id && !taskId;
              return (
                <div key={project.id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={projectSelected}
                    className={`picker-item${projectSelected ? ' selected' : ''}`}
                    onClick={() => pick(project.id, null)}
                  >
                    <ProjectDot color={project.color} />
                    <span>{project.name}</span>
                  </button>
                  {projectTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      role="option"
                      aria-selected={taskId === task.id}
                      className={`picker-item picker-subitem${taskId === task.id ? ' selected' : ''}`}
                      onClick={() => pick(project.id, task.id)}
                    >
                      {task.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {(query.trim() && !exact) || (grouped.length === 0 && !query) ? (
        <div className="picker-actions">
          {query.trim() && !exact ? (
            <button type="button" className="picker-item picker-create" onClick={() => void create()}>
              <Icon name="plus" size={14} /> Create project "{query.trim()}"
            </button>
          ) : null}
          {grouped.length === 0 && !query ? <div className="picker-empty">No projects yet. Type a name to create one.</div> : null}
        </div>
      ) : null}
    </Popover>
  );
}

/** Multi-select tag chooser; unknown names can be created. Works with tag names, like the Toggl API. */
export function TagPicker({ anchor, value, onChange, onClose }: {
  anchor: HTMLElement | null;
  value: string[];
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();
  const toast = useToast();
  const selected = new Set(value.map((name) => name.toLowerCase()));
  const visible = tags.filter((tag) => tag.name.toLowerCase().includes(query.toLowerCase()));
  const exact = tags.some((tag) => tag.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (name: string) => {
    onChange(selected.has(name.toLowerCase()) ? value.filter((v) => v.toLowerCase() !== name.toLowerCase()) : [...value, name]);
  };
  const create = async () => {
    const name = query.trim();
    if (!name || exact) return;
    try {
      const tag = await createTag.mutateAsync(name);
      onChange([...value, tag.name]);
      setQuery('');
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <input
        className="picker-search"
        autoFocus
        placeholder="Find or create tags…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (event.ctrlKey || event.metaKey || visible.length === 0) void create();
          else if (visible[0]) toggle(visible[0].name);
        }}
      />
      <div className="picker-list">
        {visible.map((tag) => (
          <label key={tag.id} className="picker-item picker-check">
            <input type="checkbox" checked={selected.has(tag.name.toLowerCase())} onChange={() => toggle(tag.name)} />
            {tag.name}
          </label>
        ))}
        {query.trim() && !exact ? (
          <button type="button" className="picker-item picker-create" onClick={() => void create()}>
            <Icon name="plus" size={14} /> Create tag "{query.trim()}"
          </button>
        ) : null}
        {tags.length === 0 && !query ? <div className="picker-empty">No tags yet. Type a name to create one.</div> : null}
      </div>
    </Popover>
  );
}
