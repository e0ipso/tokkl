import { useMemo } from 'react';
import { settingsFrom, type Settings } from '../lib/settings.ts';
import { useMe, usePreferences } from './account.ts';

/**
 * The signed-in account's settings. The object stays the same until /me or the preferences change,
 * so it can be a dependency of memos and effects.
 */
export function useSettings(): Settings {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  return useMemo(() => settingsFrom(me, prefs), [me, prefs]);
}
