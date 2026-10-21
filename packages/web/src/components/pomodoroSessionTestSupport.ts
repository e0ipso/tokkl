import type { TestContext } from 'node:test';
import { locks } from 'node:worker_threads';
import type { TimeEntryInput } from '../api/types.ts';
import { createPomodoroSessionController } from './pomodoroSessionController.ts';
import { withPomodoroSessionLock } from './pomodoroSessionLock.ts';
import { createPomodoroSessionStorage } from './pomodoroSessionState.ts';
import type { EntryDraft } from './useEntryFields.ts';

export const config = { workMinutes: 25, shortRestMinutes: 5, longRestMinutes: 15, longRestEvery: 2 };
export const fields: EntryDraft = {
  description: 'Write proposal', project_id: 3, task_id: 7, tags: ['draft'], billable: false,
};

export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
  };
}

export function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Separate tab memories share storage and Node's real exclusive LockManager. */
export function sessionFixture(t: TestContext, disk = memoryStorage()) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  t.after(() => {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else Reflect.deleteProperty(navigator, 'locks');
    disk.clear();
  });
  let instant = '2026-10-21T10:02:00.123Z';
  let clockReads = 0;
  let sequence = 0;
  const entries: TimeEntryInput[] = [];
  const messages: string[] = [];
  const grid = { minutes: 15, timeZone: 'UTC' };
  const tab = (accountId = 42, options: {
    storage?: () => Storage;
    save?: (entry: TimeEntryInput) => Promise<unknown>;
  } = {}) => {
    const storage = createPomodoroSessionStorage(accountId, options.storage ?? (() => disk));
    const controller = createPomodoroSessionController({
      read: storage.read, readUnsaved: storage.readUnsaved, write: storage.write,
      lock: (run) => withPomodoroSessionLock(accountId, run),
      now: () => { clockReads++; return new Date(instant); },
      id: () => `session-${++sequence}`,
      grid: () => grid,
      createEntry: options.save ?? (async (entry) => { entries.push(entry); }),
      hasSavedEntry: async (entry) => entries.some((saved) => saved.start === entry.start && saved.stop === entry.stop),
      message: (message) => { messages.push(message); },
    });
    t.after(() => { controller.close(); storage.forget(); });
    return { storage, controller };
  };
  return {
    disk, tab, entries, messages, grid,
    at: (value: string) => { instant = value; },
    get clockReads() { return clockReads; },
  };
}
