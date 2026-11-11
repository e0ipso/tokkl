import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from './client.ts';
import { object } from './decode.ts';
import { keys } from './keys.ts';
import { APP } from './paths.ts';
import type { AppStatus as ServerAppStatus, UserRole } from '@tokkl/types';

/** Older servers omit the signup flag; only an explicit true enables the entry point. */
type AppStatus = Omit<ServerAppStatus, 'signup_enabled'> & { signup_enabled?: boolean };

const statusQuery = queryOptions({
  queryKey: keys.status,
  queryFn: ({ signal }) => api.get<AppStatus>(`${APP}/status`, { signal, decode: object }),
  staleTime: Infinity,
});

/** It does not change while the page is open. */
export function useAppStatus() {
  return useQuery(statusQuery);
}

const pomodoroLimitsOf = (status: AppStatus) => status.pomodoro_limits;

/** Forms take their ranges and defaults from here, never from a copy. */
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

export const authRequests = {
  login: (body: { email: string; password: string }) => api.post(`${APP}/login`, body),
  setup: (body: NewAccount & { setup_code: string }) => api.post(`${APP}/setup`, body),
  logout: () => api.post(`${APP}/logout`),
  signup: (email: string) => api.post(`${APP}/signup`, { email }),
  checkInvite: (token: string) => api.get<{ role: UserRole; email?: string }>(invitePath(token), { decode: object }),
  acceptInvite: (token: string, body: NewAccount) => api.post(invitePath(token), body),
  checkReset: (token: string) => api.get<{ email: string }>(resetPath(token), { decode: object }),
  resetPassword: (token: string, password: string) => api.post(resetPath(token), { password }),
};
