import { useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { keys, useClients, useProjects, useWid, useWorkspace } from '../api/hooks.ts';
import type { Project } from '../api/types.ts';
import { Icon } from '../components/Icon.tsx';
import { ProjectDot } from '../components/Pickers.tsx';
import { duration, formatMoney, useSettings, type Settings } from '../lib/settings.ts';
import { ProjectEditor } from './manage/ProjectEditor.tsx';
import { includesText, useAction, wsPath } from './manage/queries.ts';
import {
  ConfirmModal, RowMenu, STATUS_OPTIONS, SearchBox, Segmented, StatusBadge, matchesStatus, type StatusFilter,
} from './manage/ui.tsx';
import './manage/manage.css';

type ClientFilter = 'any' | 'none' | number;
type DeletionMode = 'unassign' | 'delete';

const PROJECT_KEYS = [keys.projects, keys.tasks, keys.entries, keys.current, keys.report] as const;

function EstimateBar({ project, settings }: { project: Project; settings: Settings }) {
  if (project.estimated_hours === null || project.estimated_hours <= 0) return <span className="muted">None</span>;
  const estimateSeconds = project.estimated_hours * 3600;
  const percent = Math.round((project.actual_seconds / estimateSeconds) * 100);
  const over = percent > 100;
  return (
    <div className="estimate" title={`${duration(project.actual_seconds, settings)} of ${project.estimated_hours} h`}>
      <div className="estimate-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percent, 100)} aria-label="Estimate used">
        <div className={`estimate-fill${over ? ' is-over' : ''}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className={`estimate-label${over ? ' is-over' : ''}`}>{percent}% of {project.estimated_hours} h</span>
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
  const { data: projects, isLoading, error } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: workspace } = useWorkspace();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('any');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const visible = useMemo(() => (projects ?? []).filter((project) =>
    matchesStatus(!project.active, status)
    && (includesText(project.name, search) || includesText(project.client_name, search))
    && (clientFilter === 'any' || (clientFilter === 'none' ? project.client_id === null : project.client_id === clientFilter)),
  ), [projects, status, search, clientFilter]);

  const setActive = useAction<{ project: Project; active: boolean }, Project>({
    mutationFn: ({ project, active }) => api.put<Project>(wsPath(wid, 'projects', project.id), { active }),
    invalidate: PROJECT_KEYS,
    success: (saved) => (saved.active ? `Restored ${saved.name}` : `Archived ${saved.name}`),
  });

  const remove = useAction<{ project: Project; mode: DeletionMode }>({
    mutationFn: ({ project, mode }) => api.delete(`${wsPath(wid, 'projects', project.id)}?teDeletionMode=${mode}`),
    invalidate: [...PROJECT_KEYS, keys.trash],
    success: (_result, { project, mode }) => (mode === 'delete'
      ? `Deleted ${project.name} and moved its entries to the trash`
      : `Deleted ${project.name}. Its entries no longer have a project`),
    onSuccess: () => setDeleting(null),
  });

  // Edit the freshest copy, so the modal reflects changes made since the list loaded.
  const editingProject = editing === 'new' || editing === null ? editing : projects?.find((p) => p.id === editing.id) ?? editing;
  const defaultCurrency = workspace?.default_currency ?? 'EUR';

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1>Projects</h1>
        <span className="spacer" />
        <button type="button" className="button button-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> New project
        </button>
      </header>

      <div className="toolbar">
        <Segmented label="Project status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        <SearchBox value={search} onChange={setSearch} placeholder="Search projects" />
        <select
          aria-label="Client"
          value={String(clientFilter)}
          onChange={(event) => {
            const value = event.target.value;
            setClientFilter(value === 'any' || value === 'none' ? value : Number(value));
          }}
        >
          <option value="any">All clients</option>
          <option value="none">No client</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </div>

      {error ? <p className="form-error">Could not load projects: {error.message}</p> : null}
      {isLoading ? <p className="empty-state">Loading projects…</p> : null}
      {projects && visible.length === 0 ? (
        <p className="empty-state">
          {projects.length === 0 ? 'No projects yet. Create one to group your time entries.' : 'No projects match these filters.'}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Status</th>
                <th>Billable</th>
                <th className="num">Rate</th>
                <th className="num">Tracked</th>
                <th>Estimate</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => (
                <tr key={project.id} className={project.active ? undefined : 'archived'}>
                  <td>
                    <button type="button" className="manage-name-button" onClick={() => setEditing(project)}>
                      <ProjectDot color={project.color} />
                      <span style={{ color: project.color }}>{project.name}</span>
                    </button>
                  </td>
                  <td>{project.client_name ?? <span className="muted">None</span>}</td>
                  <td><StatusBadge archived={!project.active} /></td>
                  <td>{project.billable ? 'Yes' : <span className="muted">No</span>}</td>
                  <td className="num">{rateText(project, defaultCurrency) ?? <span className="muted">Default</span>}</td>
                  <td className="num">{duration(project.actual_seconds, settings)}</td>
                  <td><EstimateBar project={project} settings={settings} /></td>
                  <td className="manage-actions">
                    <button type="button" className="icon-button" aria-label={`Edit ${project.name}`} title="Edit" onClick={() => setEditing(project)}>
                      <Icon name="edit" size={16} />
                    </button>
                    <RowMenu
                      label={`More actions for ${project.name}`}
                      items={[
                        project.active
                          ? { label: 'Archive', onSelect: () => setActive.mutate({ project, active: false }) }
                          : { label: 'Restore', icon: 'undo', onSelect: () => setActive.mutate({ project, active: true }) },
                        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDeleting(project) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editingProject ? (
        <ProjectEditor
          key={editingProject === 'new' ? 'new' : editingProject.id}
          project={editingProject === 'new' ? null : editingProject}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          confirmLabel={deleting.actual_seconds > 0 ? 'Keep entries' : 'Delete project'}
          danger={deleting.actual_seconds === 0}
          busy={remove.isPending}
          onConfirm={() => remove.mutate({ project: deleting, mode: 'unassign' })}
          onClose={() => setDeleting(null)}
          extraActions={deleting.actual_seconds === 0 ? undefined : (
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ project: deleting, mode: 'delete' })}
            >
              Delete entries too
            </button>
          )}
        >
          <p>This deletes the project and its tasks. You can't undo it.</p>
          {deleting.actual_seconds > 0 ? (
            <p>
              It has {duration(deleting.actual_seconds, settings)} of tracked time. Keep those entries without a project,
              or delete them too. Deleted entries go to the trash. If you restore them later, they come back without a project.
            </p>
          ) : <p>It has no tracked time.</p>}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
