import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import type { Checked } from './client.ts';
import { adminAccountListReply, instanceSettingsReply, inviteListReply } from './replies.ts';
import type { AdminAccount, CreatedInvite, InstanceSettings, PasswordResetLink, UserRole } from './types.ts';

/**
 * Instance administration under /api/app/admin. The server answers 403 to anyone but an admin,
 * and that answer is what protects these routes.
 */
const ADMIN = `${APP}/admin`;

export function useAdminUsers() {
  return useQuery({
    queryKey: keys.adminUsers,
    queryFn: ({ signal }) => api.get(`${ADMIN}/users`, { signal, decode: adminAccountListReply }),
  });
}

export function useAdminInvites() {
  return useQuery({
    queryKey: keys.adminInvites,
    queryFn: ({ signal }) => api.get(`${ADMIN}/invites`, { signal, decode: inviteListReply }),
  });
}

/** The instance settings. Pass `enabled` false to hold the request, as until the users list proves admin access. */
export function useInstanceSettings(enabled = true) {
  return useQuery({
    queryKey: keys.adminSettings,
    queryFn: ({ signal }) => api.get(`${ADMIN}/settings`, { signal, decode: instanceSettingsReply }),
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
  /** The reply replaces the cached settings, so it is checked. */
  saveSettings: (changes: Partial<InstanceSettings>): Promise<Checked<InstanceSettings>> =>
    api.put(`${ADMIN}/settings`, changes, { decode: instanceSettingsReply }),
};
