import { useId, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useCreateProject, useProjects, useTasks } from '../api/projects.ts';
import { arrowTarget } from './arrowKeys.ts';
import { Icon } from './Icon.tsx';
import { Popover } from './Overlay.tsx';
import { ProjectDot } from './ProjectLabel.tsx';
import { groupPickerProjects, pickerOptions } from './projectPickerOptions.ts';
import { useToast } from './Toast.tsx';
import { t } from '../i18n/messages.ts';

/** Scrolls the active option into view when it becomes active (a ref callback, so no lookup by id). */
function revealOption(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: 'nearest' });
}

/** One listbox option. Focus stays in the search field; `active` is the option it points at. */
function PickerOptionButton({
  id,
  className,
  selected,
  active,
  onPick,
  children,
}: {
  id: string;
  className: string;
  selected: boolean;
  active: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      id={id}
      ref={active ? revealOption : undefined}
      tabIndex={-1}
      aria-selected={selected}
      className={`${className}${selected ? ' selected' : ''}${active ? ' highlighted' : ''}`}
      onClick={onPick}
    >
      {children}
    </button>
  );
}

/**
 * Project and task chooser with inline project creation (Ctrl/Cmd+Enter or the create row).
 *
 * The search field is a combobox and keeps focus. ArrowDown, ArrowUp, Home and End move the active
 * option, exposed through aria-activedescendant; Enter picks it. With no active option, Enter picks
 * the first project that matches, or creates one. Home and End move the caret until an option is
 * active.
 */
export function ProjectPicker({
  anchor,
  projectId,
  taskId,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  projectId: number | null;
  taskId: number | null;
  onChange: (projectId: number | null, taskId: number | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const createProject = useCreateProject();
  const toast = useToast();

  const groups = useMemo(() => groupPickerProjects(projects, tasks, query), [projects, tasks, query]);
  const options = useMemo(() => pickerOptions(groups, query), [groups, query]);
  const indexes = useMemo(
    () => new Map(options.map((option, index) => [`${option.projectId}:${option.taskId}`, index])),
    [options],
  );
  const optionId = (index: number) => `${listId}-${index}`;
  const indexOf = (pid: number | null, tid: number | null) => indexes.get(`${pid}:${tid}`) ?? -1;
  const activeOption = options[active];
  const isActive = (pid: number | null, tid: number | null) =>
    activeOption?.projectId === pid && activeOption.taskId === tid;

  const exact = projects.some(p => p.name.toLowerCase() === query.trim().toLowerCase());
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
    <Popover anchor={anchor} label={t('entries.pickerProjectLabel')} onClose={onClose} width={320}>
      <input
        className="picker-search"
        autoFocus
        placeholder={t('entries.pickerProjectSearch')}
        value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(active) : undefined}
        onChange={event => {
          setQuery(event.target.value);
          setActive(-1);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void create();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeOption) pick(activeOption.projectId, activeOption.taskId);
            else {
              const first = groups[0]?.rows[0];
              if (first) pick(first.project.id, null);
              else void create();
            }
          } else if (active >= 0 || event.key.startsWith('Arrow')) {
            const next = arrowTarget(event.key, active, options.length, true);
            if (next === null) return;
            event.preventDefault();
            setActive(next);
          }
        }}
      />
      <div className="picker-list" role="listbox" aria-label={t('entries.pickerProjects')} id={listId}>
        {query === '' ? (
          <PickerOptionButton
            id={optionId(indexOf(null, null))}
            className="picker-item"
            selected={projectId === null}
            active={isActive(null, null)}
            onPick={() => pick(null, null)}
          >
            <ProjectDot color={null} /> {t('entries.noProject')}
          </PickerOptionButton>
        ) : null}
        {groups.map(({ client, rows }) => (
          <div key={client || 'none'} role={client ? 'group' : 'none'} aria-label={client || undefined}>
            {client ? (
              <div className="picker-group" aria-hidden="true">
                {client}
              </div>
            ) : null}
            {rows.map(({ project, tasks: projectTasks }) => (
              <div key={project.id} role="none">
                <PickerOptionButton
                  id={optionId(indexOf(project.id, null))}
                  className="picker-item"
                  selected={projectId === project.id && !taskId}
                  active={isActive(project.id, null)}
                  onPick={() => pick(project.id, null)}
                >
                  <ProjectDot color={project.color} />
                  <span>{project.name}</span>
                </PickerOptionButton>
                {projectTasks.map(task => (
                  <PickerOptionButton
                    key={task.id}
                    id={optionId(indexOf(project.id, task.id))}
                    className="picker-item picker-subitem"
                    selected={taskId === task.id}
                    active={isActive(project.id, task.id)}
                    onPick={() => pick(project.id, task.id)}
                  >
                    {task.name}
                  </PickerOptionButton>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {(query.trim() && !exact) || (groups.length === 0 && !query) ? (
        <div className="picker-actions">
          {query.trim() && !exact ? (
            <button type="button" className="picker-item picker-create" onClick={() => void create()}>
              <Icon name="plus" size={14} /> {t('entries.createProject', { name: query.trim() })}
            </button>
          ) : null}
          {groups.length === 0 && !query ? <div className="picker-empty">{t('entries.noProjectsYet')}</div> : null}
        </div>
      ) : null}
    </Popover>
  );
}
