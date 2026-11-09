import type { TrashTotal } from '../api/types.ts';
import { t } from '../i18n/messages.ts';

/**
 * The line under the trash list when the server listed only the newest `limit` of the trashed
 * entries, or null while the count is unknown or the list is whole.
 */
export function trashLimitNotice(count: TrashTotal | undefined): string | null {
  if (!count || count.total <= count.limit) return null;
  return t('manage.trashLimit', { limit: count.limit, total: count.total });
}
