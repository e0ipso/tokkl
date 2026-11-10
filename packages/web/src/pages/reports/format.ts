import type { Grouping, Report } from '@tokkl/types';
import { activeLocale } from '../../i18n/locale.ts';
import { formatMoney } from '../../lib/format.ts';
import { t, type MessageKey } from '../../i18n/messages.ts';

const GROUPING_LABELS = {
  projects: 'reports.groupProject',
  clients: 'reports.groupClient',
  tags: 'reports.groupTag',
  time_entries: 'reports.groupDescription',
  tasks: 'reports.groupTask',
} as const satisfies Record<Grouping, MessageKey>;

const GROUPING_NOUNS = {
  projects: 'reports.groupProjectNoun',
  clients: 'reports.groupClientNoun',
  tags: 'reports.groupTagNoun',
  time_entries: 'reports.groupDescriptionNoun',
  tasks: 'reports.groupTaskNoun',
} as const satisfies Record<Grouping, MessageKey>;

const EMPTY_TITLES = {
  projects: 'reports.withoutProject',
  clients: 'reports.withoutClient',
  tags: 'reports.withoutTags',
  time_entries: 'reports.withoutDescription',
  tasks: 'reports.withoutTask',
} as const satisfies Record<Grouping, MessageKey>;

export function groupingLabel(grouping: Grouping): string {
  return t(GROUPING_LABELS[grouping]);
}

export function groupingNoun(grouping: Grouping): string {
  return t(GROUPING_NOUNS[grouping]);
}

export function groupTitle(title: string, grouping: Grouping): string {
  return title.trim() === '' ? t(EMPTY_TITLES[grouping]) : title;
}

/** Server group amounts are plain sums of cents, so they only mean something when all share one currency. */
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

const percentFormat = new Intl.NumberFormat(activeLocale.numberLocale, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatPercent(value: number): string {
  return t('reports.percent', { value: percentFormat.format(value) });
}
