import { LoadError, Loading } from '../../components/PageState.tsx';
import { ProjectDot } from '../../components/ProjectLabel.tsx';
import { duration, shortDate, weekdayName } from '../../lib/format.ts';
import { type Settings } from '../../lib/settings.ts';
import { Segmented } from '../manage/ui.tsx';
import { useWeeklyReport, type ReportFilterBody } from '../../api/reports.ts';
import type { WeeklyReport } from '@tokkl/types';
import type { ReportPatch, WeeklyRows } from './urlState.ts';
import { t } from '../../i18n/messages.ts';

function columnLabel(column: WeeklyReport['columns'][number], mode: WeeklyReport['mode']) {
  return mode === 'days'
    ? { label: weekdayName(column.start), sublabel: shortDate(column.start) }
    : {
        label: shortDate(column.start),
        sublabel: column.start === column.end ? '' : t('reports.columnTo', { date: shortDate(column.end) }),
      };
}

export function WeeklyTab({
  filters,
  by,
  settings,
  dimmed,
  update,
}: {
  filters: ReportFilterBody;
  by: WeeklyRows;
  settings: Settings;
  dimmed: boolean;
  update: (patch: ReportPatch) => void;
}) {
  const weekly = useWeeklyReport(filters, by);
  const grid = weekly.data;
  const cell = (seconds: number) => (seconds > 0 ? duration(seconds, settings) : <span className="muted">-</span>);
  const empty = by === 'projects' ? t('reports.withoutProject') : t('reports.withoutClient');
  const rowOptions: ReadonlyArray<{ value: WeeklyRows; label: string }> = [
    { value: 'projects', label: t('reports.rowsProjects') },
    { value: 'clients', label: t('reports.rowsClients') },
  ];

  return (
    <div className="report-weekly">
      <div className="toolbar">
        <Segmented
          label={t('reports.rows')}
          options={rowOptions}
          value={by}
          onChange={weeklyRows => update({ weeklyRows })}
        />
        {grid ? (
          <span className="hint">
            {grid.mode === 'days' ? t('reports.oneColumnPerDay') : t('reports.oneColumnPerWeek')}
          </span>
        ) : null}
      </div>
      {weekly.isPending ? (
        <Loading label={t('reports.loading')} />
      ) : weekly.isError && !grid ? (
        <LoadError
          className="report-error"
          message={t('reports.weeklyLoadFailed', { message: weekly.error.message })}
          onRetry={() => void weekly.refetch()}
        />
      ) : grid ? (
        <div className={`table-wrap${dimmed || (weekly.isPlaceholderData && weekly.isFetching) ? ' is-dimmed' : ''}`}>
          <table className="table weekly-table">
            <thead>
              <tr>
                <th scope="col">{by === 'projects' ? t('reports.project') : t('reports.client')}</th>
                {grid.columns.map(column => {
                  const { label, sublabel } = columnLabel(column, grid.mode);
                  return (
                    <th key={column.start} scope="col" className="num">
                      <span className="weekly-head">
                        {label}
                        <span>{sublabel}</span>
                      </span>
                    </th>
                  );
                })}
                <th scope="col" className="num">
                  {t('reports.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map(row => (
                <tr key={row.id ?? 'none'}>
                  <th scope="row" className="weekly-row-title">
                    <span className="group-title">
                      {by === 'projects' ? <ProjectDot color={row.color} /> : null}
                      <span className={row.id === null ? 'muted' : undefined}>
                        {row.id === null ? empty : row.title}
                      </span>
                    </span>
                  </th>
                  {row.cells.map((seconds, i) => (
                    <td key={grid.columns[i]!.start} className="num">
                      {cell(seconds)}
                    </td>
                  ))}
                  <td className="num strong">{duration(row.total, settings)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('reports.total')}</th>
                {grid.column_totals.map((seconds, i) => (
                  <td key={grid.columns[i]!.start} className="num strong">
                    {cell(seconds)}
                  </td>
                ))}
                <td className="num strong">{duration(grid.total, settings)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
}
