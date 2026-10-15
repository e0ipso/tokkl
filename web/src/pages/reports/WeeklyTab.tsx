import { LoadError, Loading } from '../../components/PageState.tsx';
import { ProjectDot } from '../../components/Pickers.tsx';
import { duration, shortDate, weekdayName, type Settings } from '../../lib/settings.ts';
import { Segmented } from '../manage/ui.tsx';
import { useWeeklyReport, type WeeklyReport } from './api.ts';
import type { ReportFilterBody } from './query.ts';
import type { ReportPatch, WeeklyRows } from './urlState.ts';

const ROW_OPTIONS: ReadonlyArray<{ value: WeeklyRows; label: string }> = [
  { value: 'projects', label: 'Projects' },
  { value: 'clients', label: 'Clients' },
];

/** Day columns show the weekday; week columns show the part of the week inside the range. */
function columnLabel(column: WeeklyReport['columns'][number], mode: WeeklyReport['mode']) {
  return mode === 'days'
    ? { label: weekdayName(column.start), sublabel: shortDate(column.start) }
    : { label: shortDate(column.start), sublabel: column.start === column.end ? '' : `to ${shortDate(column.end)}` };
}

export function WeeklyTab({ filters, by, settings, dimmed, update }: {
  filters: ReportFilterBody;
  by: WeeklyRows;
  settings: Settings;
  dimmed: boolean;
  update: (patch: ReportPatch) => void;
}) {
  const weekly = useWeeklyReport(filters, by);
  const grid = weekly.data;
  const cell = (seconds: number) => (seconds > 0 ? duration(seconds, settings) : <span className="muted">-</span>);
  const empty = by === 'projects' ? 'Without project' : 'Without client';

  return (
    <div className="report-weekly">
      <div className="toolbar">
        <Segmented label="Rows" options={ROW_OPTIONS} value={by} onChange={(weeklyRows) => update({ weeklyRows })} />
        {grid ? <span className="hint">{grid.mode === 'days' ? 'One column per day.' : 'Ranges longer than a week get one column per week.'}</span> : null}
      </div>
      {weekly.isPending ? (
        <Loading label="Loading report…" />
      ) : weekly.isError && !grid ? (
        <LoadError className="report-error" message={`Couldn't load the weekly report: ${weekly.error.message}`} onRetry={() => void weekly.refetch()} />
      ) : grid ? (
        <div className={`table-wrap${dimmed || (weekly.isPlaceholderData && weekly.isFetching) ? ' is-dimmed' : ''}`}>
          <table className="table weekly-table">
            <thead>
              <tr>
                <th scope="col">{by === 'projects' ? 'Project' : 'Client'}</th>
                {grid.columns.map((column) => {
                  const { label, sublabel } = columnLabel(column, grid.mode);
                  return (
                    <th key={column.start} scope="col" className="num">
                      <span className="weekly-head">{label}<span>{sublabel}</span></span>
                    </th>
                  );
                })}
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.id ?? 'none'}>
                  <th scope="row" className="weekly-row-title">
                    <span className="group-title">
                      {by === 'projects' ? <ProjectDot color={row.color} /> : null}
                      <span className={row.id === null ? 'muted' : undefined}>{row.id === null ? empty : row.title}</span>
                    </span>
                  </th>
                  {row.cells.map((seconds, i) => <td key={grid.columns[i]!.start} className="num">{cell(seconds)}</td>)}
                  <td className="num strong">{duration(row.total, settings)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                {grid.column_totals.map((seconds, i) => <td key={grid.columns[i]!.start} className="num strong">{cell(seconds)}</td>)}
                <td className="num strong">{duration(grid.total, settings)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
}
