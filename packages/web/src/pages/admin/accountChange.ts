import type { AccountChange } from '../../api/admin.ts';
import type { AdminAccount } from '@tokkl/types';
import { t } from '../../i18n/messages.ts';

/** Where its refusal shows. */
export function changeField(change: AccountChange): 'role' | 'status' {
  return 'role' in change ? 'role' : 'status';
}

export function changeMessage(updated: AdminAccount, change: AccountChange): string {
  const email = updated.email;
  if ('role' in change) return t(updated.role === 'admin' ? 'admin.nowAdmin' : 'admin.nowUser', { email });
  return t(updated.disabled_at ? 'admin.disabledAccount' : 'admin.enabledAccount', { email });
}

/** False once the typed email is the account's. */
export function deleteConfirmError(typed: string, email: string): string | false {
  return typed.trim().toLowerCase() !== email.toLowerCase() && t('admin.typeEmailToConfirm');
}
