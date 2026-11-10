import type { DurationFormat, Me, Preferences } from '@tokkl/types';
import { browserTimeZone } from './browserTimeZone.ts';

export interface Settings {
  timeZone: string;
  dateFormat: string;
  twelveHour: boolean;
  durationFormat: DurationFormat;
  beginningOfWeek: number;
  collapseSimilar: boolean;
  shortcuts: boolean;
  /** From the instance settings. */
  timeResolution: number;
}

export function isTwelveHour(timeOfDayFormat: string): boolean {
  return /a/i.test(timeOfDayFormat);
}

/** Toggl's defaults for what has not loaded. */
export function settingsFrom(me: Me | undefined, prefs: Preferences | undefined): Settings {
  return {
    timeZone: me?.timezone ?? browserTimeZone(),
    dateFormat: prefs?.date_format ?? 'YYYY-MM-DD',
    twelveHour: isTwelveHour(prefs?.timeofday_format ?? 'H:mm'),
    durationFormat: prefs?.duration_format ?? 'improved',
    beginningOfWeek: me?.beginning_of_week ?? 1,
    collapseSimilar: prefs?.collapseTimeEntries ?? true,
    shortcuts: prefs?.keyboard_shortcuts_enabled ?? true,
    timeResolution: me?.time_resolution_minutes ?? 1,
  };
}
