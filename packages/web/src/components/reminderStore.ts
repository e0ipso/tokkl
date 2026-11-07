/**
 * Where the long-timer reminder remembers, per account, which timer it already asked about and
 * whether the user confirmed it. It lives in localStorage so every tab of the account agrees, and
 * in memory when storage is blocked. Plain TypeScript with no React, so node:test can load it.
 */

export interface Reminder {
  /** The timer it is about: the entry id and start time, so correcting the start resets it. */
  timer: string;
  notified: boolean;
  confirmed: boolean;
}

export function isReminder(value: unknown): value is Reminder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'timer' in value &&
    typeof value.timer === 'string' &&
    'notified' in value &&
    typeof value.notified === 'boolean' &&
    'confirmed' in value &&
    typeof value.confirmed === 'boolean'
  );
}

export function reminderKey(accountId: number): string {
  return `tokkl.longTimerReminder.${accountId}`;
}

export interface ReminderStore {
  /** The stored reminder. The same object comes back until the stored text changes. */
  read(key: string): Reminder | null;
  write(key: string, value: Reminder): void;
  /** Calls `onChange` when this tab or another one writes the reminders. */
  subscribe(onChange: () => void): () => void;
}

export function createReminderStore(
  storage: () => Storage,
  events: Pick<Window, 'addEventListener' | 'removeEventListener'>,
) {
  const memory = new Map<string, Reminder>();
  const parsed = new Map<string, { text: string | null; value: Reminder | null }>();
  const listeners = new Set<() => void>();

  const stored = (key: string): string | null => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };

  const store: ReminderStore = {
    read(key) {
      const text = stored(key);
      const cached = parsed.get(key);
      let value: Reminder | null;
      if (cached && cached.text === text) {
        value = cached.value;
      } else {
        let decoded: unknown = null;
        try {
          decoded = JSON.parse(text ?? 'null');
        } catch {
          // Old or damaged values leave the reminder usable in this tab.
        }
        value = isReminder(decoded) ? decoded : null;
        parsed.set(key, { text, value });
      }
      return value ?? memory.get(key) ?? null;
    },
    write(key, value) {
      memory.set(key, value);
      try {
        storage().setItem(key, JSON.stringify(value));
      } catch {
        // Keep confirmation in memory when browser storage is unavailable.
      }
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key.startsWith('tokkl.longTimerReminder.')) onChange();
      };
      listeners.add(onChange);
      events.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        events.removeEventListener('storage', onStorage);
      };
    },
  };
  return store;
}
