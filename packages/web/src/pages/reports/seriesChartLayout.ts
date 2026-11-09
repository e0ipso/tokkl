import type { CSSProperties } from 'react';
import { parseDateKey } from '@tokkl/common/time';
import type { Report } from '@tokkl/types';
import { monthName, shortDate, weekdayName } from '../../lib/format.ts';
import { t } from '../../i18n/messages.ts';

/** The pure parts of SeriesChart: its geometry, scale, column shapes and labels. */

export type Point = Report['series'][number];
export type Resolution = Report['resolution'];

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Chart size in pixels. reports.css sets each value as a custom property on .series-chart. */
export interface Geometry {
  height: number;
  margin: Margin;
  maxBar: number;
  gap: number;
  radius: number;
}

/** Used for any property that is missing or not a plain pixel number. */
export const DEFAULT_GEOMETRY: Geometry = {
  height: 220,
  margin: { top: 12, right: 8, bottom: 28, left: 48 },
  maxBar: 24,
  gap: 2,
  radius: 4,
};

/** Reads a length such as `24px` or `24`. Other units, and anything else, give the fallback. */
export function readPixels(value: string, fallback: number): number {
  const trimmed = value.trim();
  return /^(\d+(\.\d+)?|\.\d+)(px)?$/.test(trimmed) ? Number.parseFloat(trimmed) : fallback;
}

/** The geometry from the chart's custom properties, read through `property` (a computed style's getPropertyValue). */
export function readGeometry(property: (name: string) => string): Geometry {
  const d = DEFAULT_GEOMETRY;
  const px = (name: string, fallback: number) => readPixels(property(name), fallback);
  return {
    height: px('--chart-height', d.height),
    margin: {
      top: px('--chart-margin-top', d.margin.top),
      right: px('--chart-margin-right', d.margin.right),
      bottom: px('--chart-margin-bottom', d.margin.bottom),
      left: px('--chart-margin-left', d.margin.left),
    },
    maxBar: px('--chart-max-bar', d.maxBar),
    gap: px('--chart-gap', d.gap),
    radius: px('--chart-radius', d.radius),
  };
}

/** A clean tick step in hours that gives about four gridlines. */
export function niceStep(maxHours: number): number {
  const raw = maxHours / 4;
  const steps = [0.25, 0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find(step => step >= raw) ?? Math.ceil(raw / 10_000) * 10_000;
}

/** The plot area, the hour scale and the column bands for `series` drawn `width` pixels wide. */
export interface ChartLayout {
  plotWidth: number;
  plotHeight: number;
  /** Gridline values in hours, from 0 to the top of the scale. */
  ticks: number[];
  /** The y coordinate of a value in hours. */
  y: (hours: number) => number;
  /** The width of each column's slot. */
  band: number;
  barWidth: number;
  /** Every how many columns an axis label fits. */
  labelEvery: number;
}

export function chartLayout(series: readonly Point[], width: number, geometry: Geometry): ChartLayout {
  const { height, margin, maxBar } = geometry;
  const count = series.length;
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const maxHours = Math.max(...series.map(p => p.seconds / 3600), 0);
  const step = niceStep(maxHours || 1);
  const top = Math.max(step, Math.ceil(maxHours / step) * step);
  const band = count ? plotWidth / count : 0;
  return {
    plotWidth,
    plotHeight,
    ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step),
    y: hours => margin.top + plotHeight - (hours / top) * plotHeight,
    band,
    barWidth: Math.max(1, Math.min(maxBar, band * 0.7)),
    labelEvery: Math.max(1, Math.ceil((count * 64) / Math.max(plotWidth, 1))),
  };
}

/** Where one column's two segments go: billable on the baseline, the rest above it past a gap. */
export interface ColumnShape {
  x: number;
  base: number;
  totalY: number;
  billableY: number;
  billableHeight: number;
  otherHeight: number;
}

export function columnShape(point: Point, index: number, layout: ChartLayout, geometry: Geometry): ColumnShape {
  const { band, barWidth, y } = layout;
  const x = geometry.margin.left + index * band + (band - barWidth) / 2;
  const totalY = y(point.seconds / 3600);
  const billableY = y(point.billable_seconds / 3600);
  const base = y(0);
  const billableHeight = base - billableY;
  const gap = billableHeight > 0 && point.seconds - point.billable_seconds > 0 ? geometry.gap : 0;
  return { x, base, totalY, billableY, billableHeight, otherHeight: Math.max(0, billableY - totalY - gap) };
}

/** A rectangle with rounded top corners and a square base, for the data end of a column. */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return (
    `M${x},${y + h}V${y + radius}A${radius},${radius} 0 0 1 ${x + radius},${y}` +
    `H${x + w - radius}A${radius},${radius} 0 0 1 ${x + w},${y + radius}V${y + h}Z`
  );
}

/** Puts the tooltip beside the hovered column, on the side with more room, so it never hides it. */
export function tooltipPosition(bandLeft: number, band: number, width: number, top: number): CSSProperties {
  return bandLeft + band / 2 < width / 2 ? { left: bandLeft + band + 4, top } : { right: width - bandLeft + 4, top };
}

const CHART_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;
type ChartKey = (typeof CHART_KEYS)[number];

/** Whether the chart reads `key`: the arrows move between columns, Home and End go to either end. */
export function isChartKey(key: string): key is ChartKey {
  return CHART_KEYS.some(chartKey => chartKey === key);
}

/** The column a chart key moves to from `current`, the active column or null for none. */
export function nextActiveColumn(key: ChartKey, current: number | null, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const from = current ?? (key === 'ArrowLeft' ? count : -1);
  return Math.max(0, Math.min(count - 1, from + (key === 'ArrowLeft' ? -1 : 1)));
}

/** The label under a column: a month, a weekday for a week or less of days, or a short date. */
export function axisLabel(point: Point, resolution: Resolution, count: number, index: number): string {
  const parsed = parseDateKey(point.start);
  if (!parsed) return point.start;
  if (resolution === 'month') {
    const month = monthName(parsed.month, 'short');
    return index === 0 || parsed.month === 1 ? t('dates.monthYear', { month, year: parsed.year }) : month;
  }
  if (resolution === 'day' && count <= 7)
    return t('dates.weekdayDay', { weekday: weekdayName(point.start), day: parsed.day });
  return shortDate(point.start);
}

/** The full name of a column's period, for the tooltip and the data table. */
export function fullLabel(point: Point, resolution: Resolution): string {
  const parsed = parseDateKey(point.start);
  if (!parsed) return point.start;
  if (resolution === 'month') return t('dates.monthYear', { month: monthName(parsed.month), year: parsed.year });
  if (resolution === 'week') return t('reports.weekOf', { date: shortDate(point.start), year: parsed.year });
  return t('dates.dayLabelWithYear', {
    weekday: weekdayName(point.start),
    date: shortDate(point.start),
    year: parsed.year,
  });
}
