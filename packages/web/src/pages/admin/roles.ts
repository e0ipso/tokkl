import type { UserRole } from '@tokkl/types';
import type { MessageKey } from '../../i18n/messages.ts';

export const ROLES: ReadonlyArray<{ value: UserRole; label: MessageKey }> = [
  { value: 'user', label: 'admin.roleUser' },
  { value: 'admin', label: 'admin.roleAdmin' },
];

export function isUserRole(value: string): value is UserRole {
  return ROLES.some(role => role.value === value);
}

export function absoluteLink(path: string): string {
  return new URL(path, window.location.origin).href;
}
