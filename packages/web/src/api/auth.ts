import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import { appStatusReply, inviteCheckReply, resetCheckReply } from './replies.ts';
import type { AppStatus } from './types.ts';

/** Signing in and out, first-run setup, and the one-time invite and password reset links. */

const statusQuery = queryOptions({
  queryKey: keys.status,
  queryFn: ({ signal }) => api.get(`${APP}/status`, { signal, decode: appStatusReply }),
  staleTime: Infinity,
});

/**
 * Whether the server still needs its first admin, and what it offers. It does not change while the
 * page is open.
 */
export function useAppStatus() {
  return useQuery(statusQuery);
}

const pomodoroLimitsOf = (status: AppStatus) => status.pomodoro_limits;

/**
 * The Pomodoro lengths the server accepts, and the ones a new account starts with, from the
 * status reply. The forms take their ranges and defaults from here, never from a copy.
 */
export function usePomodoroLimits() {
  return useQuery({ ...statusQuery, select: pomodoroLimitsOf });
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
  checkInvite: (token: string) => api.get(invitePath(token), { decode: inviteCheckReply }),
  acceptInvite: (token: string, body: NewAccount) => api.post(invitePath(token), body),
  checkReset: (token: string) => api.get(resetPath(token), { decode: resetCheckReply }),
  resetPassword: (token: string, password: string) => api.post(resetPath(token), { password }),
};
