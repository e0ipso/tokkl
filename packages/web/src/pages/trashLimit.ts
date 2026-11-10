import type { TrashTotal } from '@tokkl/types';
import { t } from '../i18n/messages.ts';

/** Null while the count is unknown or the list is whole. */
export function trashLimitNotice(count: TrashTotal | undefined): string | null {
  if (!count || count.total <= count.limit) return null;
  return t('manage.trashLimit', { limit: count.limit, total: count.total });
}
