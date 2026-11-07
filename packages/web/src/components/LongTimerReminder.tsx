import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useMe, usePreferences } from '../api/account.ts';
import { useCurrentEntry } from '../api/entries.ts';
import { keys } from '../api/keys.ts';
import { useClockSelector } from '../lib/clock.ts';
import { notifyInBackground } from './phaseNotification.ts';
import { createReminderStore, reminderKey } from './reminderStore.ts';

const reminders = createReminderStore(() => window.localStorage, window);

/**
 * Asks once per timer, after the hours set in the preferences, whether a timer is still running on
 * purpose: a banner here and a notification while the tab is in the background. A timer's start
 * time is part of its identity, so correcting it resets the confirmation.
 */
export function LongTimerReminder() {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  const { data: current } = useCurrentEntry();
  const prefsSaving = useIsMutating({ mutationKey: keys.preferences }) > 0;
  const key = reminderKey(me?.id ?? 0);
  const timer = current ? `${current.id}:${current.start}` : null;
  const hours = prefs?.long_timer_reminder_hours ?? 8;
  const enabled = Boolean(me && prefs?.long_timer_reminder_enabled);
  const startMs = current ? Date.parse(current.start) : null;
  // Checked every second, but this re-renders only when the timer passes the limit.
  const overdue = useClockSelector(
    1000,
    useCallback(now => startMs !== null && now - startMs > hours * 3_600_000, [startMs, hours]),
  );
  const due = enabled && overdue;
  const stored = useSyncExternalStore(reminders.subscribe, () => reminders.read(key));
  const confirmed = stored?.timer === timer && stored.confirmed;
  const meId = me?.id;

  useEffect(() => {
    if (!due || !timer || confirmed || prefsSaving) return;
    // Re-read just before sending so another tab's notification or confirmation takes precedence.
    const latest = reminders.read(key);
    if (latest?.timer === timer && (latest.confirmed || latest.notified)) return;
    reminders.write(key, { timer, notified: true, confirmed: false });
    notifyInBackground(
      'Is your timer still running on purpose?',
      `Your timer has been running for more than ${hours} ${hours === 1 ? 'hour' : 'hours'}. Open Tokkl to confirm or review it.`,
      `tokkl-long-timer-${meId}`,
    );
  }, [due, timer, confirmed, prefsSaving, key, hours, meId]);

  if (!due || confirmed || !timer) return null;
  return (
    <div className="timer-reminder" role="status" aria-label="Long-running timer reminder">
      <span>
        Your timer has been running for more than {hours} {hours === 1 ? 'hour' : 'hours'}. Is it still running on
        purpose?
      </span>
      <div className="inline-controls">
        <button
          type="button"
          className="button button-ghost"
          onClick={() => reminders.write(key, { timer, notified: true, confirmed: true })}
        >
          Keep running
        </button>
        <Link href="/" className="button button-ghost">
          Review timer
        </Link>
      </div>
    </div>
  );
}
