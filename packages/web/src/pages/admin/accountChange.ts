import type { AccountChange } from '../../api/admin.ts';
import type { AdminAccount } from '../../api/types.ts';
import { roleLabel } from './roles.ts';

/** The rules behind the Users table's account changes and the delete confirmation. */

/** The control a change came from, where its refusal shows. */
export function changeField(change: AccountChange): 'role' | 'status' {
  return 'role' in change ? 'role' : 'status';
}

/** The toast after a change saved. */
export function changeMessage(updated: AdminAccount, change: AccountChange): string {
  return 'role' in change
    ? `${updated.email} is now ${roleLabel(updated.role)}`
    : `${updated.disabled_at ? 'Disabled' : 'Enabled'} ${updated.email}`;
}

/** The error the delete confirmation shows, or false once the typed email is the account's. */
export function deleteConfirmError(typed: string, email: string): string | false {
  return typed.trim().toLowerCase() !== email.toLowerCase() && "Type the account's email to confirm";
}
