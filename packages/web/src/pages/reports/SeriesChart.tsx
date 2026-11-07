import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Report } from '../../api/types.ts';
import { duration } from '../../lib/format.ts';
import type { Settings } from '../../lib/settings.ts';
import { ChartDataTable, ChartTooltip, StripePattern, Swatch } from './SeriesChartParts.tsx';
import {
  axisLabel,
  chartLayout,
  columnShape,
  isChartKey,
  nextActiveColumn,
  roundedTop,
  tooltipPosition,
  type Resolution,
} from './seriesChartLayout.ts';
import { useGeometry, useWidth } from './useChartSize.ts';

const hoursFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const UNIT: Record<Resolution, string> = { day: 'day', week: 'week', month: 'month' };

/**
 * Stacked columns of tracked hours per day, week or month. Billable time sits on the baseline as a
 * solid column and the rest stacks above it in stripes, split by a surface-colored gap.
 */
export function SeriesChart({
  series,
  resolution,
  settings,
  dimmed,
}: {
  series: Report['series'];
  resolution: Resolution;
  settings: Pick<Settings, 'durationFormat'>;
  dimmed: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const width = useWidth(container);
  const geometry = useGeometry(root);
  const { height, margin, radius } = geometry;
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const chartPattern = `${id}-stripes`;
  const keyPattern = `${id}-key-stripes`;

  const count = series.length;
  const layout = chartLayout(series, width, geometry);
  const { plotHeight, ticks, y, band, barWidth, labelEvery } = layout;
  const activePoint = active !== null ? series[active] : undefined;

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const key = event.key;
    if (!isChartKey(key)) return;
    event.preventDefault();
    setActive(current => nextActiveColumn(key, current, count));
  };

  const total = series.reduce((sum, p) => sum + p.seconds, 0);
  const description =
    `Column chart of tracked hours per ${UNIT[resolution]}, ${count} ${UNIT[resolution]}s, ` +
    `${duration(total, settings)} in total. Use the arrow keys to read each ${UNIT[resolution]}.`;

  return (
    <div ref={root} className={`series-chart${dimmed ? ' is-dimmed' : ''}`}>
      <svg className="chart-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <StripePattern id={keyPattern} />
        </defs>
      </svg>
      <div className="chart-legend">
        <span>
          <Swatch series="billable" patternId={keyPattern} size={12} />
          Billable
        </span>
        <span>
          <Swatch series="other" patternId={keyPattern} size={12} />
          Non-billable
        </span>
      </div>
      <div ref={container} className="chart-frame">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={description}
            tabIndex={0}
            data-own-arrows=""
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <title>{description}</title>
            <defs>
              <StripePattern id={chartPattern} />
            </defs>
            {ticks.map(tick => (
              <g key={tick}>
                <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="chart-tick" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {hoursFormat.format(tick)} h
                </text>
              </g>
            ))}
            {series.map((point, index) => {
              const { x, base, totalY, billableY, billableHeight, otherHeight } = columnShape(
                point,
                index,
                layout,
                geometry,
              );
              const bandLeft = margin.left + index * band;
              return (
                <g key={point.start} className={active === index ? 'is-active' : undefined}>
                  {active === index ? (
                    <>
                      <rect className="chart-band" x={bandLeft} y={margin.top} width={band} height={plotHeight} />
                      <rect className="chart-band-strip" x={x} y={base + 3} width={barWidth} height={3} rx={1.5} />
                    </>
                  ) : null}
                  {billableHeight > 0 ? (
                    <path
                      className="mark-billable"
                      d={roundedTop(x, billableY, barWidth, billableHeight, otherHeight > 0 ? 0 : radius)}
                    />
                  ) : null}
                  {otherHeight > 0 ? (
                    <path
                      className="mark-other"
                      fill={`url(#${chartPattern})`}
                      d={roundedTop(x, totalY, barWidth, otherHeight, radius)}
                    />
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text className="chart-tick" x={bandLeft + band / 2} y={height - 8} textAnchor="middle">
                      {axisLabel(point, resolution, count, index)}
                    </text>
                  ) : null}
                  <rect
                    className="chart-hit"
                    x={bandLeft}
                    y={margin.top}
                    width={band}
                    height={plotHeight}
                    onPointerEnter={() => setActive(index)}
                  />
                </g>
              );
            })}
            <line className="chart-baseline" x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} />
          </svg>
        ) : null}
        {activePoint && active !== null ? (
          <ChartTooltip
            point={activePoint}
            resolution={resolution}
            settings={settings}
            keyPattern={keyPattern}
            style={tooltipPosition(margin.left + active * band, band, width, margin.top)}
          />
        ) : null}
      </div>
      <ChartDataTable series={series} resolution={resolution} settings={settings} />
    </div>
  );
}
