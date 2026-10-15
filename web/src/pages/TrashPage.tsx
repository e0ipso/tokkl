import { useState } from 'react';
import { api } from '../api/client.ts';
import { keys, useRestoreEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { ProjectDot } from '../components/Pickers.tsx';
import { useToast } from '../components/Toast.tsx';
import { localDay } from '../lib/entryTime.ts';
import { duration, entrySeconds, formatDate, formatTime, useSettings, type Settings } from '../lib/settings.ts';
import { useAction, useTrash } from './manage/queries.ts';
import { ConfirmModal, plural } from './manage/ui.tsx';
import './manage/manage.css';

function dateTime(iso: string, settings: Settings): string {
  return `${formatDate(localDay(iso, settings.timeZone), settings.dateFormat)} ${formatTime(iso, settings)}`;
}

function TrashRow({ entry, settings }: { entry: TimeEntry; settings: Settings }) {
  const toast = useToast();
  const restore = useRestoreEntry();
  const purge = useAction({
    mutationFn: () => api.delete(`/api/app/trash/${entry.id}`),
    invalidate: [keys.trash],
    success: 'Deleted the entry for good',
  });

  return (
    <tr>
      <td>{entry.description || <span className="muted">No description</span>}</td>
      <td>
        {entry.project_id !== null || entry.project_name ? (
          <span className="project-label">
            <ProjectDot color={entry.project_color} />
            <span className="project-label-name">{entry.project_name ?? 'Unknown project'}</span>
          </span>
        ) : <span className="muted">No project</span>}
      </td>
      <td className="num">{dateTime(entry.start, settings)}</td>
      <td className="num">{entry.stop ? duration(entrySeconds(entry, new Date()), settings) : <span className="muted">Running</span>}</td>
      <td className="num">{entry.server_deleted_at ? dateTime(entry.server_deleted_at, settings) : null}</td>
      <td className="manage-actions">
        <button
          type="button"
          className="button button-ghost"
          disabled={restore.isPending}
          onClick={() => restore.mutate(entry.id, {
            onSuccess: () => toast.show('Entry restored'),
            onError: (error) => toast.error(error),
          })}
        >
          <Icon name="undo" size={16} /> Restore
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Delete forever"
          title="Delete forever"
          disabled={purge.isPending}
          onClick={() => purge.mutate()}
        >
          <Icon name="trash" size={16} />
        </button>
      </td>
    </tr>
  );
}

export function TrashPage() {
  const settings = useSettings();
  const { data: entries, isLoading, error, refetch } = useTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const empty = useAction<void, { deleted: number }>({
    mutationFn: () => api.delete<{ deleted: number }>('/api/app/trash'),
    invalidate: [keys.trash],
    success: (result) => `Deleted ${plural(result.deleted, 'entry', 'entries')} for good`,
    onSuccess: () => setConfirmEmpty(false),
  });

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1>Trash</h1>
        <span className="spacer" />
        <button
          type="button"
          className="button button-danger-ghost"
          disabled={!entries || entries.length === 0}
          onClick={() => setConfirmEmpty(true)}
        >
          <Icon name="trash" size={16} /> Empty trash
        </button>
      </header>
      <p className="hint manage-intro">
        Toggl Track has no trash. Here, deleted time entries stay until you restore them or delete them for good.
      </p>

      {error ? <LoadError message={`Could not load the trash: ${error.message}`} onRetry={() => void refetch()} /> : null}
      {isLoading ? <Loading label="Loading the trash…" /> : null}
      {entries && entries.length === 0 ? <p className="empty-state">The trash is empty.</p> : null}

      {entries && entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Project</th>
                <th className="num">Started</th>
                <th className="num">Duration</th>
                <th className="num">Deleted</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => <TrashRow key={entry.id} entry={entry} settings={settings} />)}
            </tbody>
          </table>
        </div>
      ) : null}
      {entries && entries.length >= 1000 ? (
        <p className="hint manage-footnote">Showing the 1000 most recently deleted entries.</p>
      ) : null}

      {confirmEmpty && entries ? (
        <ConfirmModal
          title="Empty the trash?"
          confirmLabel="Empty trash"
          busy={empty.isPending}
          onConfirm={() => empty.mutate()}
          onClose={() => setConfirmEmpty(false)}
        >
          <p>
            This deletes {entries.length >= 1000 ? 'every entry' : plural(entries.length, 'entry', 'entries')} in the trash for good.
            You can't undo this.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
