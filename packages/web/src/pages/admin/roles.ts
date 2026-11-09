import type { UserRole } from '@tokkl/types';
import type { MessageKey } from '../../i18n/messages.ts';

/** The instance roles, with the catalog key of each one's name. */
export const ROLES: ReadonlyArray<{ value: UserRole; label: MessageKey }> = [
  { value: 'user', label: 'admin.roleUser' },
  { value: 'admin', label: 'admin.roleAdmin' },
];

/** Whether a select's value is one of the instance roles. */
export function isUserRole(value: string): value is UserRole {
  return ROLES.some(role => role.value === value);
}

/** A server path such as /invite/<token> as a full link to share. */
export function absoluteLink(path: string): string {
  return new URL(path, window.location.origin).href;
}
