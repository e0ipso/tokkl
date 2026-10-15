import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { keys, useReport } from '../api/hooks.ts';
import { LoadError, Loading } from '../components/PageState.tsx';
import { today, useSettings } from '../lib/settings.ts';
import { DetailedTab } from './reports/DetailedTab.tsx';
import { ExportButtons } from './reports/ExportButtons.tsx';
import { Filters } from './reports/Filters.tsx';
import { filterBody, reportQuery } from './reports/query.ts';
import { RangeControl } from './reports/RangeControl.tsx';
import { SummaryTab } from './reports/SummaryTab.tsx';
import { TABS, useReportState, type Tab } from './reports/urlState.ts';
import { WeeklyTab } from './reports/WeeklyTab.tsx';
import './reports/reports.css';

const TAB_LABELS: Record<Tab, string> = { summary: 'Summary', detailed: 'Detailed', weekly: 'Weekly' };

export function ReportsPage() {
  const settings = useSettings();
  const todayKey = today(settings.timeZone);
  const bounds = useQuery({
    queryKey: [...keys.report, 'bounds'],
    queryFn: () => api.get<{ first_date: string | null; last_date: string | null }>('/api/app/bounds'),
    staleTime: 5 * 60_000,
  });
  const firstDay = bounds.data?.first_date ?? null;
  const [state, update] = useReportState(todayKey, settings.beginningOfWeek, firstDay);
  const query = useMemo(() => reportQuery(state), [state]);
  const filters = useMemo(() => filterBody(state), [state]);
  const report = useReport(query);
  const data = report.data;
  const dimmed = report.isPlaceholderData && report.isFetching;

  let body: React.ReactNode;
  if (report.isPending) {
    body = <Loading label="Loading report…" />;
  } else if (report.isError && !data) {
    body = <LoadError className="report-error" message={`Couldn't load the report: ${report.error.message}`} onRetry={() => void report.refetch()} />;
  } else if (data && data.totals.entry_count === 0) {
    body = (
      <div className={`empty-state${dimmed ? ' is-dimmed' : ''}`}>
        <p>No time tracked in this range{filters.project_ids || filters.client_ids || filters.tag_ids || filters.billable !== undefined || filters.description ? ' with these filters' : ''}.</p>
        <p className="hint">Pick another range with the arrows or the date menu.</p>
      </div>
    );
  } else if (data) {
    body = state.tab === 'summary' ? (
      <SummaryTab report={data} grouping={state.grouping} subGrouping={state.subGrouping} settings={settings} dimmed={dimmed} update={update} />
    ) : state.tab === 'detailed' ? (
      <DetailedTab filters={filters} sort={state.sort} dir={state.dir} page={state.page} settings={settings} dimmed={dimmed} update={update} />
    ) : (
      <WeeklyTab filters={filters} by={state.weeklyRows} settings={settings} dimmed={dimmed} update={update} />
    );
  }

  return (
    <div className="page reports">
      <header className="page-header reports-header">
        <h1>Reports</h1>
        <RangeControl
          range={state.range}
          preset={state.preset}
          todayKey={todayKey}
          firstDay={firstDay}
          beginningOfWeek={settings.beginningOfWeek}
          update={update}
        />
        <span className="spacer" />
        <ExportButtons
          range={state.range}
          filters={filters}
          grouping={state.grouping}
          subGrouping={state.subGrouping}
          sort={state.sort}
          dir={state.dir}
          durationFormat={settings.durationFormat}
        />
      </header>
      <Filters state={state} update={update} />
      <div className="report-tabs" role="tablist" aria-label="Report type">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`report-tab-${tab}`}
            aria-selected={state.tab === tab}
            aria-controls="report-panel"
            className={`report-tab${state.tab === tab ? ' active' : ''}`}
            onClick={() => update({ tab })}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        {report.isFetching && !report.isPending ? <span className="hint report-refreshing" role="status">Updating…</span> : null}
        {report.isError && data ? <span className="hint report-stale" role="alert">Couldn't refresh. Showing the last result.</span> : null}
      </div>
      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${state.tab}`}>
        {body}
      </div>
    </div>
  );
}
