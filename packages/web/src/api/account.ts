import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './keys.ts';
import { V9, wsPath } from './paths.ts';
import type { Me, Preferences, Workspace } from './types.ts';

/** The signed-in account: /me, its preferences and its workspace. */

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>(`${V9}/me`), staleTime: 60_000 });
}

/** The account's workspace id. Only call below the auth gate, where /me has loaded. */
export function useWid(): number {
  const { data } = useMe();
  return data?.default_workspace_id ?? 0;
}

export function usePreferences() {
  return useQuery({
    queryKey: keys.preferences,
    queryFn: () => api.get<Preferences>(`${V9}/me/preferences`),
    staleTime: 60_000,
  });
}

/** Saves preference changes, showing them at once and rolling back when the save fails. */
export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    // Views that read preferences wait for this key's saves before trusting the cache.
    mutationKey: keys.preferences,
    mutationFn: (changes: Partial<Preferences>) => api.post<Preferences>(`${V9}/me/preferences`, changes),
    onMutate: changes => {
      const previous = qc.getQueryData<Preferences>(keys.preferences);
      if (previous) qc.setQueryData(keys.preferences, { ...previous, ...changes });
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) qc.setQueryData(keys.preferences, context.previous);
    },
    onSuccess: data => qc.setQueryData(keys.preferences, data),
  });
}

export function useWorkspace() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.workspace,
    queryFn: () => api.get<Workspace>(wsPath(wid)),
    enabled: wid > 0,
    staleTime: 60_000,
  });
}

export type ProfileChanges = Pick<Me, 'fullname' | 'email' | 'timezone' | 'beginning_of_week'>;
export type WorkspaceChanges = Pick<
  Workspace,
  'name' | 'default_currency' | 'default_hourly_rate' | 'rounding' | 'rounding_minutes'
>;

/** Account writes. Pass them to a mutation together with the matching `stale` list. */
export const accountRequests = {
  saveProfile: (changes: ProfileChanges) => api.put<Me>(`${V9}/me`, changes),
  changePassword: (body: { current_password: string; password: string }) => api.put(`${V9}/me`, body),
  resetApiToken: () => api.post<string>(`${V9}/me/reset_token`),
  saveWorkspace: (wid: number, changes: WorkspaceChanges) => api.put<Workspace>(wsPath(wid), changes),
};
