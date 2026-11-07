import { useMemo } from 'react';
import { useEntryBounds } from '../api/entries.ts';
import { useReport } from '../api/reports.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { useSettings } from '../api/settings.ts';
import { today } from '../lib/format.ts';
import { DetailedTab } from './reports/DetailedTab.tsx';
import { ExportButtons } from './reports/ExportButtons.tsx';
import { Filters } from './reports/Filters.tsx';
import { filterBody, reportQuery } from './reports/query.ts';
import { RangeControl } from './reports/RangeControl.tsx';
import { SummaryTab } from './reports/SummaryTab.tsx';
import { TABS, useReportState, type Tab } from './reports/urlState.ts';
import { WeeklyTab } from './reports/WeeklyTab.tsx';
import { t, type MessageKey } from '../i18n/messages.ts';
import './reports/reports.css';

const TAB_LABELS = {
  summary: 'reports.tabSummary',
  detailed: 'reports.tabDetailed',
  weekly: 'reports.tabWeekly',
} as const satisfies Record<Tab, MessageKey>;

export function ReportsPage() {
  const settings = useSettings();
  const todayKey = today(settings.timeZone);
  const bounds = useEntryBounds();
  const firstDay = bounds.data?.first_date ?? null;
  const [state, update] = useReportState(todayKey, settings.beginningOfWeek, firstDay);
  const query = useMemo(() => reportQuery(state), [state]);
  const filters = useMemo(() => filterBody(state), [state]);
  const report = useReport(query);
  const data = report.data;
  const dimmed = report.isPlaceholderData && report.isFetching;

  let body: React.ReactNode;
  if (report.isPending) {
    body = <Loading label={t('reports.loading')} />;
  } else if (report.isError && !data) {
    body = (
      <LoadError
        className="report-error"
        message={t('reports.loadFailed', { message: report.error.message })}
        onRetry={() => void report.refetch()}
      />
    );
  } else if (data && data.totals.entry_count === 0) {
    const filtered = Boolean(
      filters.project_ids ||
      filters.client_ids ||
      filters.tag_ids ||
      filters.billable !== undefined ||
      filters.description,
    );
    body = (
      <EmptyState
        className={dimmed ? 'is-dimmed' : undefined}
        icon={<Icon name="chart" size={32} />}
        title={filtered ? t('reports.emptyTitleFiltered') : t('reports.emptyTitle')}
      >
        {filtered ? t('reports.emptyHintFiltered') : t('reports.emptyHint')}
      </EmptyState>
    );
  } else if (data) {
    body =
      state.tab === 'summary' ? (
        <SummaryTab
          report={data}
          grouping={state.grouping}
          subGrouping={state.subGrouping}
          settings={settings}
          dimmed={dimmed}
          update={update}
        />
      ) : state.tab === 'detailed' ? (
        <DetailedTab
          filters={filters}
          sort={state.sort}
          dir={state.dir}
          page={state.page}
          settings={settings}
          dimmed={dimmed}
          update={update}
        />
      ) : (
        <WeeklyTab filters={filters} by={state.weeklyRows} settings={settings} dimmed={dimmed} update={update} />
      );
  }

  return (
    <div className="page reports">
      <header className="page-header reports-header">
        <h1>{t('reports.title')}</h1>
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
      <div className="report-tabs" role="tablist" aria-label={t('reports.tabsLabel')}>
        {TABS.map(tab => (
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
            {t(TAB_LABELS[tab])}
          </button>
        ))}
        {report.isFetching && !report.isPending ? (
          <span className="hint report-refreshing" role="status">
            {t('reports.updating')}
          </span>
        ) : null}
        {report.isError && data ? (
          <span className="hint report-stale" role="alert">
            {t('reports.refreshFailed')}
          </span>
        ) : null}
      </div>
      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${state.tab}`}>
        {body}
      </div>
    </div>
  );
}
