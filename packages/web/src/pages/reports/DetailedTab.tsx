import { useState } from 'react';
import { api } from '../../api/client.ts';
import type { TimeEntry } from '../../api/types.ts';
import { EntryEditor } from '../../components/EntryEditor.tsx';
import { Icon } from '../../components/Icon.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { ProjectDot } from '../../components/Pickers.tsx';
import { useToast } from '../../components/Toast.tsx';
import { localDay } from '../../lib/entryTime.ts';
import { duration, formatDate, formatTime, type Settings } from '../../lib/settings.ts';
import { useDetailedEntries } from './api.ts';
import { money } from './format.ts';
import type { ReportFilterBody } from './query.ts';
import type { ReportPatch, SortDir, SortKey } from './urlState.ts';

function SortHeader({ label, name, sort, dir, update, numeric = false }: {
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
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-button${active ? ' active' : ''}`} onClick={() => update({ sort: name, dir: next })}>
        {label}
        <span className="sort-arrow" aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

export function DetailedTab({ filters, sort, dir, page, settings, dimmed, update }: {
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

  const detailed = useDetailedEntries(filters, sort, dir, page);
  const data = detailed.data;

  const open = async (id: number) => {
    if (opening !== null) return;
    setOpening(id);
    try {
      setEditing(await api.get<TimeEntry>(`/api/v9/me/time_entries/${id}?meta=true`));
    } catch (error) {
      toast.error(error);
    } finally {
      setOpening(null);
    }
  };

  if (detailed.isPending) return <Loading label="Loading report…" />;
  if (!data) {
    return <LoadError className="report-error" message={`Couldn't load the detailed report: ${detailed.error?.message}`} onRetry={() => void detailed.refetch()} />;
  }
  const current = data.page;
  const first = (current - 1) * data.page_size;

  return (
    <div className="report-detailed">
      <div className={`table-wrap${dimmed || (detailed.isPlaceholderData && detailed.isFetching) ? ' is-dimmed' : ''}`}>
        <table className="table detailed-table">
          <thead>
            <tr>
              <SortHeader label="Date" name="date" sort={sort} dir={dir} update={update} />
              <SortHeader label="Description" name="description" sort={sort} dir={dir} update={update} />
              <th scope="col">Project</th>
              <th scope="col">Client</th>
              <th scope="col">Tags</th>
              <th scope="col">Time</th>
              <SortHeader label="Duration" name="duration" sort={sort} dir={dir} update={update} numeric />
              {data.has_amounts ? <th scope="col" className="num">Amount</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr
                key={entry.id}
                className={`entry-row${opening === entry.id ? ' is-loading' : ''}`}
                tabIndex={0}
                onClick={() => void open(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void open(entry.id);
                  }
                }}
              >
                <td className="nowrap">{formatDate(localDay(entry.start, settings.timeZone), settings.dateFormat)}</td>
                <td className="detailed-description">
                  {entry.description ? entry.description : <span className="muted">No description</span>}
                  {entry.billable ? <span className="billable-mark" title="Billable"><Icon name="dollar" size={13} title="Billable" /></span> : null}
                </td>
                <td>
                  {entry.project_name ? (
                    <span className="project-label">
                      <ProjectDot color={entry.project_color} />
                      <span className="project-label-name" title={entry.task_name ? `${entry.project_name}: ${entry.task_name}` : entry.project_name}>{entry.project_name}{entry.task_name ? `: ${entry.task_name}` : ''}</span>
                    </span>
                  ) : <span className="muted">Without project</span>}
                </td>
                <td className="detailed-client" title={entry.client_name ?? undefined}>{entry.client_name ?? ''}</td>
                <td className="detailed-tags">
                  <span className="tag-list">
                    {entry.tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
                  </span>
                </td>
                <td className="nowrap muted">{entry.all_day ? '' : `${formatTime(entry.start, settings)} – ${formatTime(entry.stop, settings)}`}</td>
                <td className="num">{duration(entry.seconds, settings)}</td>
                {data.has_amounts ? <td className="num">{money(entry.amount_cents, entry.currency)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 ? (
        <nav className="pager" aria-label="Pages">
          <button type="button" className="button button-ghost" disabled={current <= 1} onClick={() => update({ page: current - 1 })}>
            <Icon name="chevronLeft" size={16} /> Previous
          </button>
          <span className="muted">
            {(first + 1).toLocaleString()} to {(first + data.entries.length).toLocaleString()} of {data.total.toLocaleString()}
          </span>
          <button type="button" className="button button-ghost" disabled={current >= data.pages} onClick={() => update({ page: current + 1 })}>
            Next <Icon name="chevronRight" size={16} />
          </button>
        </nav>
      ) : null}
      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
