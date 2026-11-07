import { useState } from 'react';
import type { TimeEntry } from '../../api/types.ts';
import { EntryEditor } from '../../components/EntryEditor.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { ProjectDot } from '../../components/ProjectLabel.tsx';
import { useToast } from '../../components/Toast.tsx';
import { localDay } from '../../lib/entryTime.ts';
import { duration, formatCount, formatDate, formatTime } from '../../lib/format.ts';
import { type Settings } from '../../lib/settings.ts';
import { entryRequests } from '../../api/entries.ts';
import { useDetailedEntries, type ReportFilterBody } from '../../api/reports.ts';
import { money } from './format.ts';
import type { ReportPatch, SortDir, SortKey } from './urlState.ts';
import { t } from '../../i18n/messages.ts';

/** A project's name, followed by its task when there is one. */
function projectText(project: string, task: string | null): string {
  return task ? t('entries.projectWithTask', { project, task }) : project;
}

function SortHeader({
  label,
  name,
  sort,
  dir,
  update,
  numeric = false,
}: {
  label: string;
  name: SortKey;
  sort: SortKey;
  dir: SortDir;
  update: (patch: ReportPatch) => void;
  numeric?: boolean;
}) {
  const active = sort === name;
  const next: SortDir = active ? (dir === 'asc' ? 'desc' : 'asc') : name === 'description' ? 'asc' : 'desc';
  return (
    <th
      scope="col"
      className={numeric ? 'num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`sort-button${active ? ' active' : ''}`}
        onClick={() => update({ sort: name, dir: next })}
      >
        {label}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

export function DetailedTab({
  filters,
  sort,
  dir,
  page,
  settings,
  dimmed,
  update,
}: {
  filters: ReportFilterBody;
  sort: SortKey;
  dir: SortDir;
  page: number;
  settings: Settings;
  dimmed: boolean;
  update: (patch: ReportPatch) => void;
}) {
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const toast = useToast();

  const detailed = useDetailedEntries(filters, { sort, dir }, page);
  const data = detailed.data;

  const open = async (id: number) => {
    if (opening !== null) return;
    setOpening(id);
    try {
      setEditing(await entryRequests.get(id));
    } catch (error) {
      toast.error(error);
    } finally {
      setOpening(null);
    }
  };

  if (detailed.isPending) return <Loading label={t('reports.loading')} />;
  if (!data) {
    return (
      <LoadError
        className="report-error"
        message={t('reports.detailedLoadFailed', { message: String(detailed.error?.message) })}
        onRetry={() => void detailed.refetch()}
      />
    );
  }
  const current = data.page;
  const first = (current - 1) * data.page_size;

  return (
    <div className="report-detailed">
      <div className={`table-wrap${dimmed || (detailed.isPlaceholderData && detailed.isFetching) ? ' is-dimmed' : ''}`}>
        <table className="table detailed-table">
          <thead>
            <tr>
              <SortHeader label={t('reports.date')} name="date" sort={sort} dir={dir} update={update} />
              <SortHeader label={t('reports.description')} name="description" sort={sort} dir={dir} update={update} />
              <th scope="col">{t('reports.project')}</th>
              <th scope="col">{t('reports.client')}</th>
              <th scope="col">{t('reports.tags')}</th>
              <th scope="col">{t('reports.time')}</th>
              <SortHeader label={t('reports.duration')} name="duration" sort={sort} dir={dir} update={update} numeric />
              {data.has_amounts ? (
                <th scope="col" className="num">
                  {t('reports.amount')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {data.entries.map(entry => (
              <tr
                key={entry.id}
                className={`entry-row${opening === entry.id ? ' is-loading' : ''}`}
                tabIndex={0}
                onClick={() => void open(entry.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void open(entry.id);
                  }
                }}
              >
                <td className="nowrap">{formatDate(localDay(entry.start, settings.timeZone), settings.dateFormat)}</td>
                <td className="detailed-description">
                  {entry.description ? entry.description : <span className="muted">{t('reports.noDescription')}</span>}
                  {entry.billable ? (
                    <span className="billable-mark" title={t('reports.billable')}>
                      <Icon name="dollar" size={13} title={t('reports.billable')} />
                    </span>
                  ) : null}
                </td>
                <td>
                  {entry.project_name ? (
                    <span className="project-label">
                      <ProjectDot color={entry.project_color} />
                      <span className="project-label-name" title={projectText(entry.project_name, entry.task_name)}>
                        {projectText(entry.project_name, entry.task_name)}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">{t('reports.withoutProject')}</span>
                  )}
                </td>
                <td className="detailed-client" title={entry.client_name ?? undefined}>
                  {entry.client_name ?? ''}
                </td>
                <td className="detailed-tags">
                  <span className="tag-list">
                    {entry.tags.map(tag => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="nowrap muted">
                  {entry.all_day
                    ? ''
                    : t('dates.timeRange', {
                        start: formatTime(entry.start, settings),
                        end: formatTime(entry.stop, settings),
                      })}
                </td>
                <td className="num">{duration(entry.seconds, settings)}</td>
                {data.has_amounts ? <td className="num">{money(entry.amount_cents, entry.currency)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 ? (
        <nav className="pager" aria-label={t('reports.pages')}>
          <button
            type="button"
            className="button button-ghost"
            disabled={current <= 1}
            onClick={() => update({ page: current - 1 })}
          >
            <Icon name="chevronLeft" size={16} /> {t('reports.previous')}
          </button>
          <span className="muted">
            {t('reports.pageRange', {
              from: formatCount(first + 1),
              to: formatCount(first + data.entries.length),
              total: formatCount(data.total),
            })}
          </span>
          <button
            type="button"
            className="button button-ghost"
            disabled={current >= data.pages}
            onClick={() => update({ page: current + 1 })}
          >
            {t('reports.next')} <Icon name="chevronRight" size={16} />
          </button>
        </nav>
      ) : null}
      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
