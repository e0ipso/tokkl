import { useState } from 'react';
import type { Grouping, Report, ReportGroup } from '../../api/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { ProjectDot, projectColorStyle } from '../../components/Pickers.tsx';
import { duration, formatMoney, type Settings } from '../../lib/settings.ts';
import { GROUPING_LABELS, formatPercent, groupTitle, money, percent, reportCurrency } from './format.ts';
import { SeriesChart } from './SeriesChart.tsx';
import { GROUPINGS, type ReportPatch, type SubGrouping } from './urlState.ts';

function Totals({ report, settings }: { report: Report; settings: Settings }) {
  const { totals } = report;
  return (
    <dl className="report-totals">
      <div className="card">
        <dt>Total time</dt>
        <dd>{duration(totals.seconds, settings)}</dd>
      </div>
      <div className="card">
        <dt>Billable time</dt>
        <dd>
          {duration(totals.billable_seconds, settings)}
          {totals.seconds > 0 ? <span className="muted report-totals-share"> {formatPercent(percent(totals.billable_seconds, totals.seconds))}</span> : null}
        </dd>
      </div>
      <div className="card report-totals-entries">
        <dt>Entries</dt>
        <dd>{totals.entry_count.toLocaleString()}</dd>
      </div>
      {totals.amounts.length ? (
        <div className="card report-totals-amount">
          <dt>Amount</dt>
          <dd>
            {totals.amounts.map((amount) => (
              <span key={amount.currency} className="report-amount">{formatMoney(amount.cents, amount.currency)}</span>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function ShareBar({ value, color }: { value: number; color: string | null }) {
  return (
    <span className="share">
      <span className="share-track" aria-hidden="true">
        <span
          className={`share-fill${color ? ' project-fill' : ''}`}
          style={{ width: `${Math.min(100, value)}%`, ...projectColorStyle(color) }}
        />
      </span>
      <span className="share-value">{formatPercent(value)}</span>
    </span>
  );
}

function GroupRow({ group, grouping, subGrouping, total, currency, settings }: {
  group: ReportGroup;
  grouping: Grouping;
  subGrouping: SubGrouping;
  total: number;
  currency: string | null;
  settings: Settings;
}) {
  const [open, setOpen] = useState(false);
  const expandable = subGrouping !== 'none' && group.sub_groups.length > 0;
  const title = groupTitle(group.title, grouping);
  const dotColor = grouping === 'projects' ? group.color ?? 'var(--muted)' : null;
  return (
    <>
      <tr className={`group-row${open ? ' is-open' : ''}`}>
        <td>
          <span className="group-title">
            {expandable ? (
              <button
                type="button"
                className="icon-button group-toggle"
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} ${GROUPING_LABELS[subGrouping as Grouping].toLowerCase()} breakdown for ${title}`}
                onClick={() => setOpen((v) => !v)}
              >
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
              </button>
            ) : <span className="group-toggle-space" />}
            {grouping === 'projects' ? <ProjectDot color={dotColor} /> : null}
            <span className={group.title.trim() === '' ? 'muted' : undefined}>{title}</span>
          </span>
        </td>
        <td className="num">{duration(group.seconds, settings)}</td>
        <td><ShareBar value={percent(group.seconds, total)} color={dotColor} /></td>
        {currency ? <td className="num">{group.amount_cents ? money(group.amount_cents, currency) : ''}</td> : null}
      </tr>
      {open && subGrouping !== 'none' ? group.sub_groups.map((sub) => {
        const subColor = subGrouping === 'projects' ? sub.color ?? 'var(--muted)' : null;
        return (
          <tr key={`${sub.id ?? 'none'}:${sub.title}`} className="subgroup-row">
            <td>
              <span className="group-title subgroup-title">
                {subGrouping === 'projects' ? <ProjectDot color={subColor} /> : null}
                <span className={sub.title.trim() === '' ? 'muted' : undefined}>{groupTitle(sub.title, subGrouping)}</span>
              </span>
            </td>
            <td className="num">{duration(sub.seconds, settings)}</td>
            <td><ShareBar value={percent(sub.seconds, total)} color={subColor} /></td>
            {currency ? <td className="num">{sub.amount_cents ? money(sub.amount_cents, currency) : ''}</td> : null}
          </tr>
        );
      }) : null}
    </>
  );
}

export function SummaryTab({ report, grouping, subGrouping, settings, dimmed, update }: {
  report: Report;
  grouping: Grouping;
  subGrouping: SubGrouping;
  settings: Settings;
  dimmed: boolean;
  update: (patch: ReportPatch) => void;
}) {
  const currency = reportCurrency(report);
  const mixedCurrencies = report.totals.amounts.length > 1;
  return (
    <div className="report-summary">
      <Totals report={report} settings={settings} />
      <section className="card report-chart-card" aria-label="Time per period">
        <SeriesChart series={report.series} resolution={report.resolution} settings={settings} dimmed={dimmed} />
      </section>
      <section className="report-breakdown" aria-label="Breakdown">
        <div className="toolbar breakdown-toolbar">
          <label className="inline-select">
            <span>Group by</span>
            <select value={grouping} onChange={(event) => update({ grouping: event.target.value as Grouping })}>
              {GROUPINGS.map((name) => <option key={name} value={name}>{GROUPING_LABELS[name]}</option>)}
            </select>
          </label>
          <label className="inline-select">
            <span>then by</span>
            <select value={subGrouping} onChange={(event) => update({ subGrouping: event.target.value as SubGrouping })}>
              <option value="none">Nothing</option>
              {GROUPINGS.filter((name) => name !== grouping).map((name) => (
                <option key={name} value={name}>{GROUPING_LABELS[name]}</option>
              ))}
            </select>
          </label>
          {mixedCurrencies ? <span className="hint">Amounts per row are hidden because this report mixes currencies.</span> : null}
        </div>
        <div className={`table-wrap${dimmed ? ' is-dimmed' : ''}`}>
          <table className="table breakdown-table">
            <thead>
              <tr>
                <th scope="col">{GROUPING_LABELS[grouping]}</th>
                <th scope="col" className="num">Duration</th>
                <th scope="col">Share</th>
                {currency ? <th scope="col" className="num">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <GroupRow
                  key={`${grouping}:${subGrouping}:${group.id ?? 'none'}:${group.title}`}
                  group={group}
                  grouping={grouping}
                  subGrouping={subGrouping}
                  total={report.totals.seconds}
                  currency={currency}
                  settings={settings}
                />
              ))}
            </tbody>
          </table>
        </div>
        {grouping === 'tags' ? <p className="hint">Entries with several tags count once for each tag, so shares can add up to more than 100%.</p> : null}
      </section>
    </div>
  );
}
