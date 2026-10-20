import { useEffect, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Link } from 'wouter';
import { keys, useCurrentEntry, useMe, usePreferences } from '../api/hooks.ts';
import { useNow } from '../lib/settings.ts';
import { notifyInBackground } from './phaseNotification.ts';

interface Reminder {
  timer: string;
  notified: boolean;
  confirmed: boolean;
}

function read(key: string): Reminder | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value === 'object' && 'timer' in value && typeof value.timer === 'string'
      && 'notified' in value && typeof value.notified === 'boolean'
      && 'confirmed' in value && typeof value.confirmed === 'boolean') return value as Reminder;
  } catch {
    // Blocked storage and old or damaged values leave the reminder usable in this tab.
  }
  return null;
}

/** A timer's start time is part of its identity, so correcting it resets the confirmation. */
export function LongTimerReminder() {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  const { data: current } = useCurrentEntry();
  const prefsSaving = useIsMutating({ mutationKey: keys.preferences }) > 0;
  const now = useNow(1000).getTime();
  const [, refresh] = useState(0);
  const memory = useRef<{ key: string; value: Reminder } | null>(null);
  const key = `tokkl.longTimerReminder.${me?.id ?? 0}`;
  const timer = current ? `${current.id}:${current.start}` : null;
  const hours = prefs?.long_timer_reminder_hours ?? 8;
  const due = !!me && !!prefs && prefs.long_timer_reminder_enabled && !!current
    && now - Date.parse(current.start) > hours * 3_600_000;
  const stored = read(key) ?? (memory.current?.key === key ? memory.current.value : null);
  const confirmed = stored?.timer === timer && stored.confirmed;

  const write = (value: Reminder) => {
    memory.current = { key, value };
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep confirmation in memory when browser storage is unavailable.
    }
    refresh((revision) => revision + 1);
  };

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh((revision) => revision + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);

  useEffect(() => {
    if (!due || !timer || confirmed || prefsSaving) return;
    // Re-read just before sending so another tab's notification or confirmation takes precedence.
    const latest = read(key) ?? (memory.current?.key === key ? memory.current.value : null);
    if (latest?.timer === timer && (latest.confirmed || latest.notified)) return;
    write({ timer, notified: true, confirmed: false });
    notifyInBackground('Is your timer still running on purpose?',
      `Your timer has been running for more than ${hours} ${hours === 1 ? 'hour' : 'hours'}. Open Tokkl to confirm or review it.`,
      `tokkl-long-timer-${me?.id}`);
  });

  if (!due || confirmed || !timer) return null;
  return (
    <div className="timer-reminder" role="status" aria-label="Long-running timer reminder">
      <span>Your timer has been running for more than {hours} {hours === 1 ? 'hour' : 'hours'}. Is it still running on purpose?</span>
      <div className="inline-controls">
        <button type="button" className="button button-ghost"
          onClick={() => write({ timer, notified: true, confirmed: true })}>Keep running</button>
        <Link href="/" className="button button-ghost">Review timer</Link>
      </div>
    </div>
  );
}
