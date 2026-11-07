import type { CSSProperties } from 'react';
import { duration } from '../../lib/format.ts';
import type { Settings } from '../../lib/settings.ts';
import { fullLabel, type Point, type Resolution } from './seriesChartLayout.ts';

/**
 * Diagonal stripes for non-billable time, so the two series differ by texture as well as hue.
 * reports.css paints the wash and the stripes.
 */
export function StripePattern({ id }: { id: string }) {
  return (
    <pattern
      id={id}
      className="chart-stripes"
      width="6"
      height="6"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect className="chart-stripes-wash" width="6" height="6" />
      <line className="chart-stripes-line" x1="1.5" y1="0" x2="1.5" y2="6" />
    </pattern>
  );
}

/** A legend or tooltip key: solid for billable, striped for non-billable. */
export function Swatch({
  series,
  patternId,
  size,
  className,
}: {
  series: 'billable' | 'other';
  patternId: string;
  size: number;
  className?: string;
}) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false">
      <rect
        width={size}
        height={size}
        rx="2"
        className={`mark-${series}`}
        fill={series === 'other' ? `url(#${patternId})` : undefined}
      />
    </svg>
  );
}

type DurationSettings = Pick<Settings, 'durationFormat'>;

/** The hovered or focused column's totals, beside it. */
export function ChartTooltip({
  point,
  resolution,
  settings,
  keyPattern,
  style,
}: {
  point: Point;
  resolution: Resolution;
  settings: DurationSettings;
  keyPattern: string;
  style: CSSProperties;
}) {
  return (
    <div className="chart-tooltip" role="status" style={style}>
      <strong>{duration(point.seconds, settings)}</strong>
      <span className="chart-tooltip-label">{fullLabel(point, resolution)}</span>
      <span className="chart-tooltip-row">
        <Swatch className="key" series="billable" patternId={keyPattern} size={10} />
        Billable <b>{duration(point.billable_seconds, settings)}</b>
      </span>
      <span className="chart-tooltip-row">
        <Swatch className="key" series="other" patternId={keyPattern} size={10} />
        Non-billable <b>{duration(point.seconds - point.billable_seconds, settings)}</b>
      </span>
    </div>
  );
}

/** The chart's numbers as a table, folded away under a disclosure. */
export function ChartDataTable({
  series,
  resolution,
  settings,
}: {
  series: readonly Point[];
  resolution: Resolution;
  settings: DurationSettings;
}) {
  return (
    <details className="chart-data">
      <summary>Show chart data as a table</summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{resolution === 'day' ? 'Day' : resolution === 'week' ? 'Week' : 'Month'}</th>
              <th scope="col" className="num">
                Total
              </th>
              <th scope="col" className="num">
                Billable
              </th>
              <th scope="col" className="num">
                Non-billable
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map(point => (
              <tr key={point.start}>
                <td>{fullLabel(point, resolution)}</td>
                <td className="num">{duration(point.seconds, settings)}</td>
                <td className="num">{duration(point.billable_seconds, settings)}</td>
                <td className="num">{duration(point.seconds - point.billable_seconds, settings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
