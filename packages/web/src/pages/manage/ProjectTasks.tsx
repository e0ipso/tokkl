import { useEffect, useRef, useState } from 'react';
import { useWid } from '../../api/account.ts';
import { stale } from '../../api/keys.ts';
import type { Project, Task } from '../../api/types.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { useSettings } from '../../api/settings.ts';
import { duration } from '../../lib/format.ts';
import { projectRequests, taskTrackedSeconds, useProjectTasks } from '../../api/projects.ts';
import { useAction } from '../../components/useAction.ts';
import { keepFocusPastRow } from './rowFocus.ts';
import { t } from '../../i18n/messages.ts';

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
  // The flip is kept with the stored value it was made against, so a refetch that changes the
  // stored value replaces it.
  const [flip, setFlip] = useState<{ active: boolean; over: boolean } | null>(null);
  const active = flip && flip.over === task.active ? flip.active : task.active;
  const setActive = (next: boolean) => setFlip({ active: next, over: task.active });

  const update = useAction<Partial<Pick<Task, 'name' | 'active'>>, Task>({
    mutationFn: changes => projectRequests.updateTask(wid, project.id, task.id, changes),
    invalidate: stale.tasks,
    movesTimer: true,
    onSuccess: saved => setName(saved.name),
  });
  const remove = useAction({
    mutationFn: () => projectRequests.removeTask(wid, project.id, task.id),
    invalidate: stale.tasks,
    movesTimer: true,
    success: t('manage.deletedTask', { name: task.name }),
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
        aria-label={t('manage.taskDone', { name: task.name })}
        title={active ? t('manage.markDone') : t('manage.markNotDone')}
        onChange={event => {
          const nextActive = !event.target.checked;
          setActive(nextActive);
          update.mutate({ active: nextActive }, { onError: () => setFlip(null) });
        }}
      />
      <input
        className="inline-input"
        value={name}
        aria-label={t('manage.taskName')}
        maxLength={255}
        onChange={event => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={event => {
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
          <button
            type="button"
            className="button button-danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('common.delete')}
          </button>
          <button ref={keepButton} type="button" className="button button-ghost" onClick={() => confirm(false)}>
            {t('manage.keep')}
          </button>
        </span>
      ) : (
        <button
          ref={deleteButton}
          type="button"
          className="icon-button"
          aria-label={t('manage.deleteTaskNamed', { name: task.name })}
          title={t('manage.deleteTask')}
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
    mutationFn: name => projectRequests.createTask(wid, project.id, name),
    invalidate: stale.tasks,
    onSuccess: () => setNewName(''),
  });

  const add = () => {
    const trimmed = newName.trim();
    if (!fields.validate([['name', !trimmed && t('manage.enterTaskName')]])) return;
    create.mutate(trimmed);
  };

  const open = tasks?.filter(task => task.active) ?? [];
  const done = tasks?.filter(task => !task.active) ?? [];

  return (
    <section className="project-tasks" aria-label={t('manage.tasks')}>
      <h3 ref={heading} tabIndex={-1}>
        {t('manage.tasks')}
      </h3>
      {project.active ? (
        <div className="inline-controls">
          <input
            {...nameField}
            ref={element => {
              nameField.ref(element);
              newTask.current = element;
            }}
            value={newName}
            placeholder={t('manage.addTaskPlaceholder')}
            aria-label={t('manage.newTaskName')}
            maxLength={255}
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="button" disabled={create.isPending} onClick={add}>
            <Icon name="plus" size={16} /> {t('manage.addTask')}
          </button>
        </div>
      ) : (
        <p className="hint">{t('manage.restoreToAddTasks')}</p>
      )}
      {project.active ? fields.message('name') : null}
      {isLoading ? <Loading label={t('manage.loadingTasks')} className="is-compact" /> : null}
      {error && !tasks ? (
        <LoadError
          message={t('manage.tasksLoadFailed', { message: error.message })}
          onRetry={() => void refetch()}
          className="is-compact"
        />
      ) : null}
      {tasks && tasks.length === 0 ? (
        <EmptyState compact title={t('manage.noTasksYet')}>
          {project.active ? t('manage.noTasksBody') : null}
        </EmptyState>
      ) : null}
      {tasks && tasks.length > 0 ? (
        <ul className="task-list" ref={list}>
          {[...open, ...done].map(task => (
            <TaskRow key={task.id} project={project} task={task} onDeleted={() => deleted(task.id)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
