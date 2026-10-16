import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { keys, useWid } from '../../api/hooks.ts';
import type { Project, Task } from '../../api/types.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { duration, useSettings } from '../../lib/settings.ts';
import { taskTrackedSeconds, useAction, useProjectTasks, wsPath } from './queries.ts';
import { keepFocusPastRow } from './rowFocus.ts';

const TASK_KEYS = [keys.tasks, keys.entries, keys.current, keys.report] as const;

function TaskRow({ project, task, onDeleted }: { project: Project; task: Task; onDeleted: () => void }) {
  const wid = useWid();
  const settings = useSettings();
  const [name, setName] = useState(task.name);
  const [confirming, setConfirming] = useState(false);
  // Opening or closing the inline confirm unmounts the focused button, so focus follows the swap:
  // to Keep when it opens, back to "Delete task" when it closes.
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const focusAfterSwap = useRef(false);
  useEffect(() => {
    if (!focusAfterSwap.current) return;
    focusAfterSwap.current = false;
    (confirming ? keepButton : deleteButton).current?.focus();
  }, [confirming]);
  const confirm = (next: boolean) => {
    focusAfterSwap.current = true;
    setConfirming(next);
  };
  // Flip the checkbox right away; the refetch after the save confirms it.
  const [active, setActive] = useState(task.active);
  useEffect(() => setActive(task.active), [task.active]);
  const path = wsPath(wid, 'projects', project.id, 'tasks', task.id);

  const update = useAction<Partial<Pick<Task, 'name' | 'active'>>, Task>({
    mutationFn: (changes) => api.put<Task>(path, changes),
    invalidate: TASK_KEYS,
    onSuccess: (saved) => setName(saved.name),
  });
  const remove = useAction({
    mutationFn: () => api.delete<null>(path),
    invalidate: TASK_KEYS,
    success: `Deleted task ${task.name}`,
    onSuccess: onDeleted,
  });

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(task.name);
    if (trimmed !== task.name) update.mutate({ name: trimmed }, { onError: () => setName(task.name) });
  };

  return (
    <li className={`task-row${active ? '' : ' is-done'}`} data-id={task.id}>
      <input
        type="checkbox"
        checked={!active}
        aria-label={`${task.name} is done`}
        title={active ? 'Mark as done' : 'Mark as not done'}
        onChange={(event) => {
          const nextActive = !event.target.checked;
          setActive(nextActive);
          update.mutate({ active: nextActive }, { onError: () => setActive(task.active) });
        }}
      />
      <input
        className="inline-input"
        value={name}
        aria-label="Task name"
        maxLength={255}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.stopPropagation();
            setName(task.name);
          }
        }}
      />
      <span className="task-tracked num">{duration(taskTrackedSeconds(task), settings)}</span>
      {confirming ? (
        <span className="inline-controls">
          <button type="button" className="button button-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</button>
          <button ref={keepButton} type="button" className="button button-ghost" onClick={() => confirm(false)}>Keep</button>
        </span>
      ) : (
        <button
          ref={deleteButton}
          type="button"
          className="icon-button"
          aria-label={`Delete task ${task.name}`}
          title="Delete task"
          data-row-action="delete"
          onClick={() => confirm(true)}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </li>
  );
}

/** Task list for one project: add, rename, mark done and delete. */
export function ProjectTasks({ project }: { project: Project }) {
  const wid = useWid();
  const fields = useFieldErrors<'name'>();
  const { data: tasks, isLoading, error, refetch } = useProjectTasks(project.id);
  const [newName, setNewName] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const newTask = useRef<HTMLInputElement | null>(null);
  const nameField = fields.field('name');
  // A deleted task's row goes away with the refetch. Focus moves to the next task's "Delete task",
  // else the previous one's, else the new task field, or the heading when the project is archived.
  const deleted = (id: number) => keepFocusPastRow(list.current, id, 'delete', newTask.current ?? heading.current);

  const create = useAction<string, Task>({
    mutationFn: (name) => api.post<Task>(wsPath(wid, 'projects', project.id, 'tasks'), { name }),
    invalidate: TASK_KEYS,
    onSuccess: () => setNewName(''),
  });

  const add = () => {
    const trimmed = newName.trim();
    if (!fields.validate([['name', !trimmed && 'Enter a task name']])) return;
    create.mutate(trimmed);
  };

  const open = tasks?.filter((task) => task.active) ?? [];
  const done = tasks?.filter((task) => !task.active) ?? [];

  return (
    <section className="project-tasks" aria-label="Tasks">
      <h3 ref={heading} tabIndex={-1}>Tasks</h3>
      {project.active ? (
        <div className="inline-controls">
          <input
            {...nameField}
            ref={(element) => {
              nameField.ref(element);
              newTask.current = element;
            }}
            value={newName}
            placeholder="Add a task"
            aria-label="New task name"
            maxLength={255}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="button" disabled={create.isPending} onClick={add}>
            <Icon name="plus" size={16} /> Add task
          </button>
        </div>
      ) : (
        <p className="hint">Restore the project to add tasks.</p>
      )}
      {project.active ? fields.message('name') : null}
      {isLoading ? <Loading label="Loading tasks…" className="is-compact" /> : null}
      {error && !tasks ? <LoadError message={`Could not load tasks: ${error.message}`} onRetry={() => void refetch()} className="is-compact" /> : null}
      {tasks && tasks.length === 0 ? (
        <EmptyState compact title="No tasks yet.">{project.active ? "Add one above to split this project's time." : null}</EmptyState>
      ) : null}
      {tasks && tasks.length > 0 ? (
        <ul className="task-list" ref={list}>
          {[...open, ...done].map((task) => <TaskRow key={task.id} project={project} task={task} onDeleted={() => deleted(task.id)} />)}
        </ul>
      ) : null}
    </section>
  );
}
