import { mutationOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type Checked } from './client.ts';
import { keys } from './keys.ts';
import { V9, wsPath } from './paths.ts';
import { createPreferenceSaves, type PreferenceSaves } from './preferenceSaves.ts';
import { meReply, preferencesReply, workspaceReply } from './replies.ts';
import type { Me, Preferences, Workspace } from './types.ts';

/** The signed-in account: /me, its preferences and its workspace. */

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: ({ signal }) => api.get(`${V9}/me`, { signal, decode: meReply }),
    staleTime: 60_000,
  });
}

/** The account's workspace id. Only call below the auth gate, where /me has loaded. */
export function useWid(): number {
  const { data } = useMe();
  return data?.default_workspace_id ?? 0;
}

export function usePreferences() {
  return useQuery({
    queryKey: keys.preferences,
    queryFn: ({ signal }) => api.get(`${V9}/me/preferences`, { signal, decode: preferencesReply }),
    staleTime: 60_000,
  });
}

const preferenceSaves = new WeakMap<QueryClient, PreferenceSaves>();

function savesOf(qc: QueryClient): PreferenceSaves {
  let saves = preferenceSaves.get(qc);
  if (!saves) {
    saves = createPreferenceSaves();
    preferenceSaves.set(qc, saves);
  }
  return saves;
}

/** Sends preference changes. The reply replaces the cached preferences, so it must be `Checked`. */
export type SendPreferences = (changes: Partial<Preferences>) => Promise<Checked<Preferences>>;

const sendPreferences: SendPreferences = changes =>
  api.post(`${V9}/me/preferences`, changes, { decode: preferencesReply });

/**
 * Saving preference changes: shown at once, sent one at a time in the order made, and on failure
 * only the failed save's own changes are dropped (see `PreferenceSaves`).
 */
export function savePreferencesOptions(qc: QueryClient, send: SendPreferences = sendPreferences) {
  const show = (preferences: Preferences | undefined) => {
    if (preferences) qc.setQueryData(keys.preferences, preferences);
  };
  return mutationOptions({
    // Views that read preferences wait for this key's saves before trusting the cache.
    mutationKey: keys.preferences,
    // One save at a time, so the server applies them in order and the replies arrive in order.
    scope: { id: 'preferences' },
    mutationFn: send,
    onMutate: (changes: Partial<Preferences>) => {
      const { save, shown } = savesOf(qc).begin(qc.getQueryData<Preferences>(keys.preferences), changes);
      show(shown);
      return { save };
    },
    onError: (_error, _changes, context) => {
      if (context) show(savesOf(qc).failed(context.save));
    },
    onSuccess: (data, _changes, context) => show(savesOf(qc).succeeded(context.save, data)),
  });
}

export function useSavePreferences() {
  return useMutation(savePreferencesOptions(useQueryClient()));
}

export function useWorkspace() {
  const wid = useWid();
  return useQuery({
    queryKey: keys.workspace,
    queryFn: ({ signal }) => api.get(wsPath(wid), { signal, decode: workspaceReply }),
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
