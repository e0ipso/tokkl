import { useMemo } from 'react';
import type { Report, ReportEntry } from '../../api/types.ts';
import { ProjectDot } from '../../components/Pickers.tsx';
import { addDays, dateKey, startOfWeek } from '../../../../shared/time.ts';
import { duration, shortDate, weekdayName, type Settings } from '../../lib/settings.ts';
import { rangeDays, type DateRange } from './range.ts';
import type { ReportPatch, WeeklyRows } from './urlState.ts';

interface Column {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string;
}

interface Row {
  readonly key: string;
  readonly title: string;
  readonly color: string | null;
  readonly cells: number[];
  total: number;
}

export interface WeeklyGrid {
  readonly mode: 'days' | 'weeks';
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
  readonly columnTotals: readonly number[];
  readonly total: number;
}

/** A week column labelled with the part of the week that falls inside the range. */
function weekColumn(weekStart: string, range: DateRange): Column {
  const from = weekStart < range.from ? range.from : weekStart;
  const last = addDays(weekStart, 6);
  const to = last > range.to ? range.to : last;
  return { key: weekStart, label: shortDate(from), sublabel: from === to ? '' : `to ${shortDate(to)}` };
}

/**
 * Builds a rows-by-columns grid from report entries: one column per day for ranges up to a
 * week, one per week (starting on the account's first weekday) for anything longer.
 */
export function buildWeeklyGrid(
  entries: readonly ReportEntry[], range: DateRange, by: WeeklyRows, timeZone: string, beginningOfWeek: number,
): WeeklyGrid {
  const mode = rangeDays(range) <= 7 ? 'days' : 'weeks';
  const columns: Column[] = [];
  const first = mode === 'days' ? range.from : startOfWeek(range.from, beginningOfWeek);
  for (let key = first; key <= range.to; key = addDays(key, mode === 'days' ? 1 : 7)) {
    columns.push(mode === 'days'
      ? { key, label: weekdayName(key), sublabel: shortDate(key) }
      : weekColumn(key, range));
  }
  const index = new Map(columns.map((column, i) => [column.key, i]));
  const rows = new Map<string, Row>();
  const columnTotals = columns.map(() => 0);
  let total = 0;
  for (const entry of entries) {
    const day = dateKey(new Date(entry.start), timeZone);
    const column = index.get(mode === 'days' ? day : startOfWeek(day, beginningOfWeek));
    if (column === undefined) continue;
    const key = by === 'projects' ? `p:${entry.project_id ?? 'none'}` : `c:${entry.client_name ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = by === 'projects'
        ? { key, title: entry.project_name ?? '', color: entry.project_color, cells: columns.map(() => 0), total: 0 }
        : { key, title: entry.client_name ?? '', color: null, cells: columns.map(() => 0), total: 0 };
      rows.set(key, row);
    }
    row.cells[column]! += entry.seconds;
    row.total += entry.seconds;
    columnTotals[column]! += entry.seconds;
    total += entry.seconds;
  }
  const sorted = [...rows.values()].sort((a, b) => {
    if (a.title === '' || b.title === '') return a.title === '' ? 1 : -1;
    return b.total - a.total || a.title.localeCompare(b.title);
  });
  return { mode, columns, rows: sorted, columnTotals, total };
}

export function WeeklyTab({ report, range, by, settings, dimmed, update }: {
  report: Report;
  range: DateRange;
  by: WeeklyRows;
  settings: Settings;
  dimmed: boolean;
  update: (patch: ReportPatch) => void;
}) {
  const grid = useMemo(
    () => buildWeeklyGrid(report.entries, range, by, settings.timeZone, settings.beginningOfWeek),
    [report.entries, range, by, settings.timeZone, settings.beginningOfWeek],
  );
  const cell = (seconds: number) => (seconds > 0 ? duration(seconds, settings) : <span className="muted">-</span>);
  const empty = by === 'projects' ? 'Without project' : 'Without client';
  const truncated = report.totals.entry_count > report.entries.length;

  return (
    <div className="report-weekly">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Rows">
          <button type="button" className={by === 'projects' ? 'active' : ''} aria-pressed={by === 'projects'} onClick={() => update({ weeklyRows: 'projects' })}>
            Projects
          </button>
          <button type="button" className={by === 'clients' ? 'active' : ''} aria-pressed={by === 'clients'} onClick={() => update({ weeklyRows: 'clients' })}>
            Clients
          </button>
        </div>
        <span className="hint">{grid.mode === 'days' ? 'One column per day.' : 'Ranges longer than a week get one column per week.'}</span>
      </div>
      {truncated ? (
        <p className="hint">Only the latest {report.entries.length.toLocaleString()} entries are counted. Narrow the range for exact totals.</p>
      ) : null}
      <div className={`table-wrap${dimmed ? ' is-dimmed' : ''}`}>
        <table className="table weekly-table">
          <thead>
            <tr>
              <th scope="col">{by === 'projects' ? 'Project' : 'Client'}</th>
              {grid.columns.map((column) => (
                <th key={column.key} scope="col" className="num">
                  <span className="weekly-head">{column.label}<span>{column.sublabel}</span></span>
                </th>
              ))}
              <th scope="col" className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="weekly-row-title">
                  <span className="group-title">
                    {by === 'projects' ? <ProjectDot color={row.color} /> : null}
                    <span className={row.title ? undefined : 'muted'}>{row.title || empty}</span>
                  </span>
                </th>
                {row.cells.map((seconds, i) => <td key={grid.columns[i]!.key} className="num">{cell(seconds)}</td>)}
                <td className="num strong">{duration(row.total, settings)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {grid.columnTotals.map((seconds, i) => <td key={grid.columns[i]!.key} className="num strong">{cell(seconds)}</td>)}
              <td className="num strong">{duration(grid.total, settings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
