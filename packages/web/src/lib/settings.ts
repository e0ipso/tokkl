import type { DurationFormat, Me, Preferences } from '../api/types.ts';
import { browserTimeZone } from './browserTimeZone.ts';

/** The account and preference values the views format and compute with. */
export interface Settings {
  timeZone: string;
  dateFormat: string;
  twelveHour: boolean;
  durationFormat: DurationFormat;
  beginningOfWeek: number;
  collapseSimilar: boolean;
  shortcuts: boolean;
  /** Minutes every saved entry's duration is a multiple of, from the instance settings. */
  timeResolution: number;
}

/** Whether a Toggl time-of-day format such as "h:mm A" shows a 12-hour clock. */
export function isTwelveHour(timeOfDayFormat: string): boolean {
  return /a/i.test(timeOfDayFormat);
}

/** The settings from /me and the preferences, with Toggl's defaults for what has not loaded. */
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
