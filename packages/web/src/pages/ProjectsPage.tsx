import { useMemo, useRef, useState } from 'react';
import { useWid, useWorkspace } from '../api/account.ts';
import { useClients } from '../api/clients.ts';
import { stale } from '../api/keys.ts';
import { projectRequests, useProjects, type ProjectDeletionMode } from '../api/projects.ts';
import type { Project } from '@tokkl/types';
import { Icon } from '../components/Icon.tsx';
import { closeModalThen } from '../components/Overlay.tsx';
import { ProjectDot } from '../components/ProjectLabel.tsx';
import { useSettings } from '../api/settings.ts';
import { duration, formatMoney } from '../lib/format.ts';
import { type Settings } from '../lib/settings.ts';
import { ProjectEditor } from './manage/ProjectEditor.tsx';
import { useAction } from '../components/useAction.ts';
import { focusPastRow, keepFocusPastRow } from './manage/rowFocus.ts';
import { ConfirmModal, RowMenu, SearchBox, Segmented, StatusBadge } from './manage/ui.tsx';
import { includesText, matchesStatus, statusOptions, type StatusFilter } from './manage/values.ts';
import { ManageList } from './manage/ManageList.tsx';
import { t } from '../i18n/messages.ts';

type ClientFilter = 'any' | 'none' | number;

function EstimateBar({ project, settings }: { project: Project; settings: Settings }) {
  if (project.estimated_hours === null || project.estimated_hours <= 0)
    return <span className="muted">{t('manage.none')}</span>;
  const estimateSeconds = project.estimated_hours * 3600;
  const percent = Math.round((project.actual_seconds / estimateSeconds) * 100);
  const over = percent > 100;
  return (
    <div
      className="estimate"
      title={t('manage.estimateTitle', {
        tracked: duration(project.actual_seconds, settings),
        hours: project.estimated_hours,
      })}
    >
      <div
        className="estimate-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-label={t('manage.estimateUsed')}
      >
        <div className={`estimate-fill${over ? ' is-over' : ''}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className={`estimate-label${over ? ' is-over' : ''}`}>
        {t('manage.estimateLabel', { percent, hours: project.estimated_hours })}
      </span>
    </div>
  );
}

function rateText(project: Project, defaultCurrency: string): string | null {
  if (project.rate === null) return null;
  return formatMoney(Math.round(project.rate * 100), project.currency ?? defaultCurrency);
}

export function ProjectsPage() {
  const wid = useWid();
  const settings = useSettings();
  const projectsQuery = useProjects();
  const { data: projects } = projectsQuery;
  const { data: clients = [] } = useClients();
  const { data: workspace } = useWorkspace();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('any');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const visible = useMemo(
    () =>
      (projects ?? []).filter(
        project =>
          matchesStatus(!project.active, status) &&
          (includesText(project.name, search) || includesText(project.client_name, search)) &&
          (clientFilter === 'any' ||
            (clientFilter === 'none' ? project.client_id === null : project.client_id === clientFilter)),
      ),
    [projects, status, search, clientFilter],
  );

  const setActive = useAction<{ project: Project; active: boolean }, Project>({
    mutationFn: ({ project, active }) => projectRequests.update(wid, project.id, { active }),
    invalidate: stale.projects,
    movesTimer: true,
    success: saved =>
      saved.active ? t('manage.restoredNamed', { name: saved.name }) : t('manage.archivedNamed', { name: saved.name }),
    // The row leaves the list when the status filter no longer matches. The menu button that ran the
    // action had focus; keep it in the list unless the user has moved on.
    onSuccess: saved => {
      if (!matchesStatus(!saved.active, status)) keepFocusPastRow(tbody.current, saved.id, 'menu', heading.current);
    },
  });

  const remove = useAction<{ project: Project; mode: ProjectDeletionMode }>({
    mutationFn: ({ project, mode }) => projectRequests.remove(wid, project.id, mode),
    invalidate: stale.projectDeleted,
    movesTimer: true,
    success: (_result, { project, mode }) =>
      mode === 'delete'
        ? t('manage.projectDeletedToTrash', { name: project.name })
        : t('manage.projectDeletedUnassigned', { name: project.name }),
    onSuccess: (_result, { project }) => {
      // The dialog had focus and would give it back to the row's menu button, which goes away.
      closeModalThen(
        () => setDeleting(null),
        () => focusPastRow(tbody.current, project.id, 'menu', heading.current),
      );
    },
  });

  // Edit the freshest copy, so the modal reflects changes made since the list loaded.
  const editingProject =
    editing === 'new' || editing === null ? editing : (projects?.find(p => p.id === editing.id) ?? editing);
  const defaultCurrency = workspace?.default_currency ?? 'EUR';

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          {t('manage.projectsTitle')}
        </h1>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> {t('manage.newProject')}
        </button>
      </header>

      <div className="toolbar">
        <Segmented label={t('manage.projectStatus')} value={status} options={statusOptions()} onChange={setStatus} />
        <SearchBox value={search} onChange={setSearch} placeholder={t('manage.searchProjects')} />
        <select
          aria-label={t('manage.client')}
          value={String(clientFilter)}
          onChange={event => {
            const value = event.target.value;
            setClientFilter(value === 'any' || value === 'none' ? value : Number(value));
          }}
        >
          <option value="any">{t('manage.allClients')}</option>
          <option value="none">{t('manage.noClient')}</option>
          {clients.map(client => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <ManageList
        query={projectsQuery}
        visible={visible}
        noun={t('manage.projectsNoun')}
        empty={{
          icon: 'folder',
          title: t('manage.noProjectsYet'),
          body: t('manage.noProjectsBody'),
        }}
        noMatch={{
          title: t('manage.noProjectsMatch'),
          body: t('manage.noProjectsMatchBody'),
        }}
        headers={
          <>
            <th>{t('manage.project')}</th>
            <th>{t('manage.client')}</th>
            <th>{t('manage.status')}</th>
            <th>{t('manage.billable')}</th>
            <th className="num">{t('manage.rate')}</th>
            <th className="num">{t('manage.tracked')}</th>
            <th>{t('manage.estimate')}</th>
          </>
        }
        tbodyRef={tbody}
      >
        {visible.map(project => (
          <tr key={project.id} data-id={project.id} className={project.active ? undefined : 'archived'}>
            <td>
              <button type="button" className="manage-name-button" onClick={() => setEditing(project)}>
                <ProjectDot color={project.color} />
                <span>{project.name}</span>
              </button>
            </td>
            <td>{project.client_name ?? <span className="muted">{t('manage.none')}</span>}</td>
            <td>
              <StatusBadge archived={!project.active} />
            </td>
            <td>{project.billable ? t('manage.yes') : <span className="muted">{t('manage.no')}</span>}</td>
            <td className="num">
              {rateText(project, defaultCurrency) ?? <span className="muted">{t('manage.rateDefault')}</span>}
            </td>
            <td className="num">{duration(project.actual_seconds, settings)}</td>
            <td>
              <EstimateBar project={project} settings={settings} />
            </td>
            <td className="manage-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={t('manage.editNamed', { name: project.name })}
                title={t('manage.edit')}
                onClick={() => setEditing(project)}
              >
                <Icon name="edit" size={16} />
              </button>
              <RowMenu
                label={t('manage.moreActionsFor', { name: project.name })}
                items={[
                  project.active
                    ? { label: t('manage.archive'), onSelect: () => setActive.mutate({ project, active: false }) }
                    : {
                        label: t('manage.restore'),
                        icon: 'undo',
                        onSelect: () => setActive.mutate({ project, active: true }),
                      },
                  { label: t('common.delete'), icon: 'trash', danger: true, onSelect: () => setDeleting(project) },
                ]}
              />
            </td>
          </tr>
        ))}
      </ManageList>

      {editingProject ? (
        <ProjectEditor
          key={editingProject === 'new' ? 'new' : editingProject.id}
          project={editingProject === 'new' ? null : editingProject}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title={t('manage.deleteNamed', { name: deleting.name })}
          confirmLabel={deleting.actual_seconds > 0 ? t('manage.keepEntries') : t('manage.deleteProject')}
          danger={deleting.actual_seconds === 0}
          busy={remove.isPending}
          onConfirm={() => remove.mutate({ project: deleting, mode: 'unassign' })}
          onClose={() => setDeleting(null)}
          extraActions={
            deleting.actual_seconds === 0 ? undefined : (
              <button
                type="button"
                className="button button-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ project: deleting, mode: 'delete' })}
              >
                {t('manage.deleteEntriesToo')}
              </button>
            )
          }
        >
          <p>{t('manage.deleteProjectBody')}</p>
          {deleting.actual_seconds > 0 ? (
            <p>{t('manage.deleteProjectTracked', { tracked: duration(deleting.actual_seconds, settings) })}</p>
          ) : (
            <p>{t('manage.deleteProjectUntracked')}</p>
          )}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
