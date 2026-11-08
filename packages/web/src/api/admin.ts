import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import type { AdminAccount, CreatedInvite, InstanceSettings, Invite, PasswordResetLink, UserRole } from './types.ts';

/**
 * Instance administration under /api/app/admin. The server answers 403 to anyone but an admin,
 * and that answer is what protects these routes.
 */
const ADMIN = `${APP}/admin`;

export function useAdminUsers() {
  return useQuery({
    queryKey: keys.adminUsers,
    queryFn: ({ signal }) => api.get<AdminAccount[]>(`${ADMIN}/users`, { signal }),
  });
}

export function useAdminInvites() {
  return useQuery({
    queryKey: keys.adminInvites,
    queryFn: ({ signal }) => api.get<Invite[]>(`${ADMIN}/invites`, { signal }),
  });
}

/** The instance settings. Pass `enabled` false to hold the request, as until the users list proves admin access. */
export function useInstanceSettings(enabled = true) {
  return useQuery({
    queryKey: keys.adminSettings,
    queryFn: ({ signal }) => api.get<InstanceSettings>(`${ADMIN}/settings`, { signal }),
    enabled,
  });
}

export type AccountChange = { role: UserRole } | { disabled: boolean };

/** Admin writes. Pass them to a mutation together with the matching `stale` list. */
export const adminRequests = {
  updateUser: (id: number, change: AccountChange) => api.patch<AdminAccount>(`${ADMIN}/users/${id}`, change),
  /** Signs the account out of every browser. Its API token keeps working. */
  revokeSessions: (id: number) => api.post(`${ADMIN}/users/${id}/sessions/revoke`),
  createPasswordReset: (id: number) => api.post<PasswordResetLink>(`${ADMIN}/users/${id}/password-reset`),
  /** Deletes the account; the server checks the typed email against it. */
  deleteUser: (id: number, email: string) => api.delete(`${ADMIN}/users/${id}`, { email }),
  createInvite: (body: { role: UserRole; note: string }) => api.post<CreatedInvite>(`${ADMIN}/invites`, body),
  revokeInvite: (id: number) => api.delete(`${ADMIN}/invites/${id}`),
  saveSettings: (changes: Partial<InstanceSettings>) => api.put<InstanceSettings>(`${ADMIN}/settings`, changes),
};
