import { useState } from 'react';
import { entryRequests, useRestoreEntry, useTrash } from '../api/entries.ts';
import { stale } from '../api/keys.ts';
import type { TimeEntry } from '../api/types.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { ProjectDot } from '../components/ProjectLabel.tsx';
import { useToast } from '../components/Toast.tsx';
import { useSettings } from '../api/settings.ts';
import { duration, formatDateTime } from '../lib/format.ts';
import { type Settings } from '../lib/settings.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { useAction } from '../components/useAction.ts';
import { ConfirmModal } from './manage/ui.tsx';
import './manage/manage.css';
import { t } from '../i18n/messages.ts';

function TrashRow({ entry, settings }: { entry: TimeEntry; settings: Settings }) {
  const toast = useToast();
  const restore = useRestoreEntry();
  const purge = useAction({
    mutationFn: () => entryRequests.purge(entry.id),
    invalidate: stale.trash,
    success: t('manage.purged'),
  });

  return (
    <tr>
      <td>{entry.description || <span className="muted">{t('manage.noDescription')}</span>}</td>
      <td>
        {entry.project_id !== null || entry.project_name ? (
          <span className="project-label">
            <ProjectDot color={entry.project_color} />
            <span className="project-label-name">{entry.project_name ?? t('manage.unknownProject')}</span>
          </span>
        ) : (
          <span className="muted">{t('manage.noProject')}</span>
        )}
      </td>
      <td className="num">{formatDateTime(entry.start, settings)}</td>
      <td className="num">
        {entry.stop ? (
          duration(entrySeconds(entry, new Date()), settings)
        ) : (
          <span className="muted">{t('manage.running')}</span>
        )}
      </td>
      <td className="num">{entry.server_deleted_at ? formatDateTime(entry.server_deleted_at, settings) : null}</td>
      <td className="manage-actions">
        <button
          type="button"
          className="button button-ghost"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(entry.id, {
              onSuccess: () => toast.show(t('manage.entryRestored')),
              onError: error => toast.error(error),
            })
          }
        >
          <Icon name="undo" size={16} /> {t('manage.restore')}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('manage.deleteForever')}
          title={t('manage.deleteForever')}
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
    mutationFn: entryRequests.emptyTrash,
    invalidate: stale.trash,
    success: result => t('manage.trashEmptied', { count: result.deleted }),
    onSuccess: () => setConfirmEmpty(false),
  });

  return (
    <div className="page manage-page">
      <header className="page-header">
        <h1>{t('manage.trashTitle')}</h1>
        <span className="spacer" />
        <button
          type="button"
          className="button button-danger-ghost"
          disabled={!entries || entries.length === 0}
          onClick={() => setConfirmEmpty(true)}
        >
          <Icon name="trash" size={16} /> {t('manage.emptyTrash')}
        </button>
      </header>
      <p className="hint manage-intro">{t('manage.trashIntro')}</p>

      {error ? (
        <LoadError message={t('manage.trashLoadFailed', { message: error.message })} onRetry={() => void refetch()} />
      ) : null}
      {isLoading ? <Loading label={t('manage.loadingTrash')} /> : null}
      {entries && entries.length === 0 ? (
        <EmptyState icon={<Icon name="trash" size={32} />} title={t('manage.trashEmpty')}>
          {t('manage.trashEmptyBody')}
        </EmptyState>
      ) : null}

      {entries && entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('manage.description')}</th>
                <th>{t('manage.project')}</th>
                <th className="num">{t('manage.started')}</th>
                <th className="num">{t('manage.duration')}</th>
                <th className="num">{t('manage.deleted')}</th>
                <th>
                  <span className="visually-hidden">{t('manage.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <TrashRow key={entry.id} entry={entry} settings={settings} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {entries && entries.length >= 1000 ? <p className="hint manage-footnote">{t('manage.trashLimit')}</p> : null}

      {confirmEmpty && entries ? (
        <ConfirmModal
          title={t('manage.emptyTrashTitle')}
          confirmLabel={t('manage.emptyTrash')}
          busy={empty.isPending}
          onConfirm={() => empty.mutate()}
          onClose={() => setConfirmEmpty(false)}
        >
          <p>
            {entries.length >= 1000
              ? t('manage.emptyTrashAll')
              : t('manage.emptyTrashCount', { count: entries.length })}
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
