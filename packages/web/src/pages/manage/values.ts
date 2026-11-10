import { t } from '../../i18n/messages.ts';

/** Empty means null; anything invalid means undefined. */
export function parseOptionalAmount(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function includesText(haystack: string | null | undefined, query: string): boolean {
  return (haystack ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export type StatusFilter = 'active' | 'archived' | 'all';

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
