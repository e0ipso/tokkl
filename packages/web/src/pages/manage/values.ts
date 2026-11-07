import { t } from '../../i18n/messages.ts';

/** Parses an optional non-negative number field. Empty means null; anything invalid means undefined. */
export function parseOptionalAmount(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function includesText(haystack: string | null | undefined, query: string): boolean {
  return (haystack ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

/** The status filter of the manage lists: active, archived or every row. */
export type StatusFilter = 'active' | 'archived' | 'all';

/** The status filter's choices, with their labels. */
export function statusOptions(): ReadonlyArray<{ value: StatusFilter; label: string }> {
  return [
    { value: 'active', label: t('manage.statusActive') },
    { value: 'archived', label: t('manage.statusArchived') },
    { value: 'all', label: t('manage.statusAll') },
  ];
}

export function matchesStatus(archived: boolean, filter: StatusFilter): boolean {
  return filter === 'all' || (filter === 'archived') === archived;
}
