import type { Grouping, Report } from '../../api/types.ts';
import { formatMoney } from '../../lib/settings.ts';

export const GROUPING_LABELS: Record<Grouping, string> = {
  projects: 'Project',
  clients: 'Client',
  tags: 'Tag',
  time_entries: 'Description',
  tasks: 'Task',
};

const EMPTY_TITLES: Record<Grouping, string> = {
  projects: 'Without project',
  clients: 'Without client',
  tags: 'Without tags',
  time_entries: 'Without description',
  tasks: 'Without task',
};

export function groupTitle(title: string, grouping: Grouping): string {
  return title.trim() === '' ? EMPTY_TITLES[grouping] : title;
}

/**
 * The single currency amounts can be shown in. Group amounts from the server are plain sums of
 * cents, so they only mean something when every amount in the report shares one currency.
 */
export function reportCurrency(report: Report): string | null {
  const [first, ...rest] = report.totals.amounts;
  return first && rest.length === 0 ? first.currency : null;
}

export function money(cents: number | null, currency: string | null): string {
  return cents === null || currency === null ? '' : formatMoney(cents, currency);
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formatPercent(value: number): string {
  return `${percentFormat.format(value)}%`;
}
