import type { Grouping, Report } from '../../api/types.ts';
import { NUMBER_LOCALE } from '../../i18n/locale.ts';
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

/** A grouping's name as a column heading or option, such as "Project". */
export function groupingLabel(grouping: Grouping): string {
  return t(GROUPING_LABELS[grouping]);
}

/** A grouping's name inside a sentence, such as "project" in "Show project breakdown". */
export function groupingNoun(grouping: Grouping): string {
  return t(GROUPING_NOUNS[grouping]);
}

export function groupTitle(title: string, grouping: Grouping): string {
  return title.trim() === '' ? t(EMPTY_TITLES[grouping]) : title;
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

const percentFormat = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formatPercent(value: number): string {
  return t('reports.percent', { value: percentFormat.format(value) });
}
