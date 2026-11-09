import type { AccountChange } from '../../api/admin.ts';
import type { AdminAccount } from '@tokkl/types';
import { t } from '../../i18n/messages.ts';

/** The rules behind the Users table's account changes and the delete confirmation. */

/** The control a change came from, where its refusal shows. */
export function changeField(change: AccountChange): 'role' | 'status' {
  return 'role' in change ? 'role' : 'status';
}

/** The toast after a change saved. */
export function changeMessage(updated: AdminAccount, change: AccountChange): string {
  const email = updated.email;
  if ('role' in change) return t(updated.role === 'admin' ? 'admin.nowAdmin' : 'admin.nowUser', { email });
  return t(updated.disabled_at ? 'admin.disabledAccount' : 'admin.enabledAccount', { email });
}

/** The error the delete confirmation shows, or false once the typed email is the account's. */
export function deleteConfirmError(typed: string, email: string): string | false {
  return typed.trim().toLowerCase() !== email.toLowerCase() && t('admin.typeEmailToConfirm');
}
