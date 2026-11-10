import { useMemo } from 'react';
import { settingsFrom, type Settings } from '../lib/settings.ts';
import { useMe, usePreferences } from './account.ts';

/** Stable until /me or the preferences change, so it can be a memo or effect dependency. */
export function useSettings(): Settings {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  return useMemo(() => settingsFrom(me, prefs), [me, prefs]);
}
