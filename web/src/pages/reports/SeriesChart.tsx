import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Report } from '../../api/types.ts';
import { parseDateKey } from '../../../../shared/time.ts';
import { duration, shortDate, weekdayName, type Settings } from '../../lib/settings.ts';

type Point = Report['series'][number];
type Resolution = Report['resolution'];

type Margin = { top: number; right: number; bottom: number; left: number };

/** Chart size in pixels. reports.css sets each value as a custom property on .series-chart. */
type Geometry = { height: number; margin: Margin; maxBar: number; gap: number; radius: number };

/** Used for any property that is missing or not a plain pixel number. */
const DEFAULT_GEOMETRY: Geometry = {
  height: 220,
  margin: { top: 12, right: 8, bottom: 28, left: 48 },
  maxBar: 24,
  gap: 2,
  radius: 4,
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const hoursFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Reads a length such as `24px` or `24`. Other units, and anything else, give the fallback. */
function readPixels(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = style.getPropertyValue(property).trim();
  return /^(\d+(\.\d+)?|\.\d+)(px)?$/.test(value) ? Number.parseFloat(value) : fallback;
}

function readGeometry(style: CSSStyleDeclaration): Geometry {
  const d = DEFAULT_GEOMETRY;
  return {
    height: readPixels(style, '--chart-height', d.height),
    margin: {
      top: readPixels(style, '--chart-margin-top', d.margin.top),
      right: readPixels(style, '--chart-margin-right', d.margin.right),
      bottom: readPixels(style, '--chart-margin-bottom', d.margin.bottom),
      left: readPixels(style, '--chart-margin-left', d.margin.left),
    },
    maxBar: readPixels(style, '--chart-max-bar', d.maxBar),
    gap: readPixels(style, '--chart-gap', d.gap),
    radius: readPixels(style, '--chart-radius', d.radius),
  };
}

/** Reads the geometry from the element's custom properties once, before the first paint. */
function useGeometry(ref: React.RefObject<HTMLElement | null>): Geometry {
  const [geometry, setGeometry] = useState(DEFAULT_GEOMETRY);
  useLayoutEffect(() => {
    if (ref.current) setGeometry(readGeometry(getComputedStyle(ref.current)));
  }, [ref]);
  return geometry;
}

/** A clean tick step in hours that gives about four gridlines. */
function niceStep(maxHours: number): number {
  const raw = maxHours / 4;
  const steps = [0.25, 0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((step) => step >= raw) ?? Math.ceil(raw / 10_000) * 10_000;
}

function axisLabel(point: Point, resolution: Resolution, count: number, index: number): string {
  const parsed = parseDateKey(point.start)!;
  if (resolution === 'month') {
    const month = MONTHS[parsed.month - 1]!.slice(0, 3);
    return index === 0 || parsed.month === 1 ? `${month} ${parsed.year}` : month;
  }
  if (resolution === 'day' && count <= 7) return `${weekdayName(point.start)} ${parsed.day}`;
  return shortDate(point.start);
}

function fullLabel(point: Point, resolution: Resolution): string {
  const parsed = parseDateKey(point.start)!;
  if (resolution === 'month') return `${MONTHS[parsed.month - 1]} ${parsed.year}`;
  if (resolution === 'week') return `Week of ${shortDate(point.start)} ${parsed.year}`;
  return `${weekdayName(point.start)}, ${shortDate(point.start)} ${parsed.year}`;
}

/** A rectangle with rounded top corners and a square base, for the data end of a column. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + radius}A${radius},${radius} 0 0 1 ${x + radius},${y}`
    + `H${x + w - radius}A${radius},${radius} 0 0 1 ${x + w},${y + radius}V${y + h}Z`;
}

/** Puts the tooltip beside the hovered column, on the side with more room, so it never hides it. */
function tooltipPosition(bandLeft: number, band: number, width: number, top: number): React.CSSProperties {
  return bandLeft + band / 2 < width / 2
    ? { left: bandLeft + band + 4, top }
    : { right: width - bandLeft + 4, top };
}

const UNIT: Record<Resolution, string> = { day: 'day', week: 'week', month: 'month' };

/**
 * Diagonal stripes for non-billable time, so the two series differ by texture as well as hue.
 * reports.css paints the wash and the stripes.
 */
function StripePattern({ id }: { id: string }) {
  return (
    <pattern id={id} className="chart-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect className="chart-stripes-wash" width="6" height="6" />
      <line className="chart-stripes-line" x1="1.5" y1="0" x2="1.5" y2="6" />
    </pattern>
  );
}

/** A legend or tooltip key: solid for billable, striped for non-billable. */
function Swatch({ series, patternId, size, className }: {
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

/**
 * Stacked columns of tracked hours per day, week or month. Billable time sits on the baseline as a
 * solid column and the rest stacks above it in stripes, split by a surface-colored gap.
 */
export function SeriesChart({ series, resolution, settings, dimmed }: {
  series: Report['series'];
  resolution: Resolution;
  settings: Pick<Settings, 'durationFormat'>;
  dimmed: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const width = useWidth(container);
  const { height, margin, maxBar, gap: segmentGap, radius } = useGeometry(root);
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const chartPattern = `${id}-stripes`;
  const keyPattern = `${id}-key-stripes`;

  const count = series.length;
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const maxHours = Math.max(...series.map((p) => p.seconds / 3600), 0);
  const step = niceStep(maxHours || 1);
  const top = Math.max(step, Math.ceil(maxHours / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const y = (hours: number) => margin.top + plotHeight - (hours / top) * plotHeight;
  const band = count ? plotWidth / count : 0;
  const barWidth = Math.max(1, Math.min(maxBar, band * 0.7));
  const labelEvery = Math.max(1, Math.ceil((count * 64) / Math.max(plotWidth, 1)));
  const activePoint = active !== null ? series[active] : undefined;

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    setActive((current) => {
      if (event.key === 'Home') return 0;
      if (event.key === 'End') return count - 1;
      const from = current ?? (event.key === 'ArrowLeft' ? count : -1);
      return Math.max(0, Math.min(count - 1, from + (event.key === 'ArrowLeft' ? -1 : 1)));
    });
  };

  const total = series.reduce((sum, p) => sum + p.seconds, 0);
  const description = `Column chart of tracked hours per ${UNIT[resolution]}, ${count} ${UNIT[resolution]}s, `
    + `${duration(total, settings)} in total. Use the arrow keys to read each ${UNIT[resolution]}.`;

  return (
    <div ref={root} className={`series-chart${dimmed ? ' is-dimmed' : ''}`}>
      <svg className="chart-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs><StripePattern id={keyPattern} /></defs>
      </svg>
      <div className="chart-legend">
        <span><Swatch series="billable" patternId={keyPattern} size={12} />Billable</span>
        <span><Swatch series="other" patternId={keyPattern} size={12} />Non-billable</span>
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
            <defs><StripePattern id={chartPattern} /></defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="chart-tick" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {hoursFormat.format(tick)} h
                </text>
              </g>
            ))}
            {series.map((point, index) => {
              const x = margin.left + index * band + (band - barWidth) / 2;
              const totalY = y(point.seconds / 3600);
              const billableY = y(point.billable_seconds / 3600);
              const base = y(0);
              const billableHeight = base - billableY;
              const otherSeconds = point.seconds - point.billable_seconds;
              const gap = billableHeight > 0 && otherSeconds > 0 ? segmentGap : 0;
              const otherHeight = Math.max(0, billableY - totalY - gap);
              return (
                <g key={point.start} className={active === index ? 'is-active' : undefined}>
                  {active === index ? (
                    <rect className="chart-band" x={margin.left + index * band} y={margin.top} width={band} height={plotHeight} />
                  ) : null}
                  {billableHeight > 0 ? (
                    <path className="mark-billable" d={roundedTop(x, billableY, barWidth, billableHeight, otherHeight > 0 ? 0 : radius)} />
                  ) : null}
                  {otherHeight > 0 ? (
                    <path className="mark-other" fill={`url(#${chartPattern})`} d={roundedTop(x, totalY, barWidth, otherHeight, radius)} />
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text className="chart-tick" x={margin.left + index * band + band / 2} y={height - 8} textAnchor="middle">
                      {axisLabel(point, resolution, count, index)}
                    </text>
                  ) : null}
                  <rect
                    className="chart-hit"
                    x={margin.left + index * band}
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
          <div
            className="chart-tooltip"
            role="status"
            style={tooltipPosition(margin.left + active * band, band, width, margin.top)}
          >
            <strong>{duration(activePoint.seconds, settings)}</strong>
            <span className="chart-tooltip-label">{fullLabel(activePoint, resolution)}</span>
            <span className="chart-tooltip-row">
              <Swatch className="key" series="billable" patternId={keyPattern} size={10} />Billable <b>{duration(activePoint.billable_seconds, settings)}</b>
            </span>
            <span className="chart-tooltip-row">
              <Swatch className="key" series="other" patternId={keyPattern} size={10} />Non-billable <b>{duration(activePoint.seconds - activePoint.billable_seconds, settings)}</b>
            </span>
          </div>
        ) : null}
      </div>
      <details className="chart-data">
        <summary>Show chart data as a table</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{resolution === 'day' ? 'Day' : resolution === 'week' ? 'Week' : 'Month'}</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Billable</th>
                <th scope="col" className="num">Non-billable</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
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
    </div>
  );
}
