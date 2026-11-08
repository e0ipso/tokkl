import { useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import type { AppStatus, UserRole } from './types.ts';

/** Signing in and out, first-run setup, and the one-time invite and password reset links. */

/** Whether the server still needs its first admin. It does not change while the page is open. */
export function useAppStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: ({ signal }) => api.get<AppStatus>(`${APP}/status`, { signal }),
    staleTime: Infinity,
  });
}

export interface NewAccount {
  email: string;
  password: string;
  fullname: string;
  timezone: string;
}

const invitePath = (token: string) => `${APP}/invites/${encodeURIComponent(token)}`;
const resetPath = (token: string) => `${APP}/password-resets/${encodeURIComponent(token)}`;

/** Session and link requests. A successful login, setup or invite starts a session cookie. */
export const authRequests = {
  login: (body: { email: string; password: string }) => api.post(`${APP}/login`, body),
  setup: (body: NewAccount & { setup_code: string }) => api.post(`${APP}/setup`, body),
  logout: () => api.post(`${APP}/logout`),
  checkInvite: (token: string) => api.get<{ role: UserRole }>(invitePath(token)),
  acceptInvite: (token: string, body: NewAccount) => api.post(invitePath(token), body),
  checkReset: (token: string) => api.get<{ email: string }>(resetPath(token)),
  resetPassword: (token: string, password: string) => api.post(resetPath(token), { password }),
};
