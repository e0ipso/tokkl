import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEOMETRY,
  axisLabel,
  chartLayout,
  columnShape,
  fullLabel,
  isChartKey,
  nextActiveColumn,
  niceStep,
  readGeometry,
  readPixels,
  roundedTop,
  tooltipPosition,
} from './seriesChartLayout.ts';

test('pixel lengths read plain and px numbers only', () => {
  assert.equal(readPixels(' 24px ', 1), 24);
  assert.equal(readPixels('.5', 1), 0.5);
  assert.equal(readPixels('2rem', 1), 1);
  assert.equal(readPixels('', 1), 1);
});

test('the geometry falls back per property', () => {
  const geometry = readGeometry(name => (name === '--chart-height' ? '300px' : ''));
  assert.deepEqual(geometry, { ...DEFAULT_GEOMETRY, height: 300 });
});

test('the tick step is the first clean step over a quarter of the maximum', () => {
  assert.equal(niceStep(1), 0.25);
  assert.equal(niceStep(7), 2);
  assert.equal(niceStep(30_000), 10_000);
});

test('the scale tops out at a whole number of steps and maps hours to y', () => {
  const series = [
    { start: '2026-10-26', seconds: 7 * 3600, billable_seconds: 3600 },
    { start: '2026-10-27', seconds: 0, billable_seconds: 0 },
  ];
  const layout = chartLayout(series, 456, DEFAULT_GEOMETRY);
  assert.equal(layout.plotWidth, 400);
  assert.equal(layout.plotHeight, 180);
  assert.deepEqual(layout.ticks, [0, 2, 4, 6, 8]);
  assert.equal(layout.y(0), 192);
  assert.equal(layout.y(8), 12);
  assert.equal(layout.band, 200);
  assert.equal(layout.barWidth, 24);
  assert.equal(layout.labelEvery, 1);
});

test('a column with both kinds of time leaves a gap between its segments', () => {
  const series = [{ start: '2026-10-26', seconds: 4 * 3600, billable_seconds: 2 * 3600 }];
  const layout = chartLayout(series, 456, DEFAULT_GEOMETRY);
  const point = series[0];
  assert.ok(point);
  const shape = columnShape(point, 0, layout, DEFAULT_GEOMETRY);
  assert.equal(shape.x, 48 + (400 - 24) / 2);
  assert.equal(shape.billableHeight, shape.base - shape.billableY);
  assert.equal(shape.otherHeight, shape.billableY - shape.totalY - DEFAULT_GEOMETRY.gap);
  const billableOnly = columnShape({ ...point, billable_seconds: point.seconds }, 0, layout, DEFAULT_GEOMETRY);
  assert.equal(billableOnly.otherHeight, 0);
});

test('rounded tops shrink the radius to fit the column', () => {
  assert.equal(roundedTop(0, 0, 10, 2, 4), 'M0,2V2A2,2 0 0 1 2,0H8A2,2 0 0 1 10,2V2Z');
});

test('the tooltip goes on the side with more room', () => {
  assert.deepEqual(tooltipPosition(10, 20, 400, 12), { left: 34, top: 12 });
  assert.deepEqual(tooltipPosition(300, 20, 400, 12), { right: 104, top: 12 });
});

test('the keys move between columns and stop at either end', () => {
  assert.equal(isChartKey('ArrowLeft'), true);
  assert.equal(isChartKey('ArrowUp'), false);
  assert.equal(nextActiveColumn('ArrowRight', null, 5), 0);
  assert.equal(nextActiveColumn('ArrowLeft', null, 5), 4);
  assert.equal(nextActiveColumn('ArrowRight', 4, 5), 4);
  assert.equal(nextActiveColumn('Home', 3, 5), 0);
  assert.equal(nextActiveColumn('End', 0, 5), 4);
});

test('labels name months, weeks and days', () => {
  const month = { start: '2026-01-01', seconds: 0, billable_seconds: 0 };
  assert.equal(axisLabel(month, 'month', 12, 3), 'Jan 2026');
  assert.equal(axisLabel({ ...month, start: '2026-03-01' }, 'month', 12, 3), 'Mar');
  assert.equal(fullLabel(month, 'month'), 'January 2026');
  assert.match(fullLabel(month, 'week'), /^Week of .* 2026$/);
});
