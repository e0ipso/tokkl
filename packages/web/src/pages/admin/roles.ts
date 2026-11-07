import type { UserRole } from '../../api/types.ts';

export const ROLES: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

/** Whether a select's value is one of the instance roles. */
export function isUserRole(value: string): value is UserRole {
  return ROLES.some(role => role.value === value);
}

export function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'an admin' : 'a regular user';
}

/** A server path such as /invite/<token> as a full link to share. */
export function absoluteLink(path: string): string {
  return new URL(path, window.location.origin).href;
}
