import { nextPhase, plannedEnd, pomodoroEntrySpan, startSession, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { TimeEntryInput } from '../api/types.ts';
import type { EntryDraft } from './useEntryFields.ts';
import { irrecoverablePomodoroError, pomodoroRetryDelay } from './pomodoroSessionRetry.ts';
import { sessionFields, type UnsavedPomodoro, type PomodoroSessionState } from './pomodoroSessionState.ts';

export interface SessionEnvironment {
  read: () => PomodoroSessionState | null;
  readUnsaved: () => UnsavedPomodoro[];
  write: (state: PomodoroSessionState | null, claim?: boolean, unsaved?: UnsavedPomodoro[]) => void;
  lock: <T>(run: () => Promise<T>) => Promise<T>;
  now: () => Date;
  id: () => string;
  grid: () => { minutes: number; timeZone: string };
  createEntry: (entry: TimeEntryInput) => Promise<unknown>;
  hasSavedEntry: (entry: UnsavedPomodoro['entry']) => Promise<boolean>;
  message: (message: string) => void;
  beforeStart?: (at: Date) => Promise<void>;
  timerLock?: <T>(run: () => Promise<T>) => Promise<T>;
}

/** Plain TS so the clock, storage, lock and request can all be supplied by a caller. */
export function createPomodoroSessionController(env: SessionEnvironment) {
  let closed = false;
  let signingOut = false;
  const localTimers = new Map<number, number>();
  const timerLock = env.timerLock ?? env.lock;
  const snapshot = (state: PomodoroSessionState, at: Date): UnsavedPomodoro | null => {
    const { minutes, timeZone } = env.grid();
    const span = pomodoroEntrySpan(new Date(state.pomodoroStart), at, minutes, timeZone);
    if (!span) {
      env.message('This pomodoro was too short to save.');
      return null;
    }
    return {
      id: `${state.id}:${state.pomodoroStart}`, attempts: 0, retryAt: at.getTime(),
      entry: {
        ...sessionFields(state.fields), start: span.start.toISOString(), stop: span.stop.toISOString(),
        duration: (span.stop.getTime() - span.start.getTime()) / 1000,
      },
    };
  };
  const remove = (id: string) => {
    if (!closed) env.write(env.read(), true, env.readUnsaved().filter((item) => item.id !== id));
  };
  const save = async (item: UnsavedPomodoro, at: Date) => {
    // Persist before making a request. Even a crash before its response requires reconciliation.
    const attempted = { ...item, attempts: item.attempts + 1,
      retryAt: at.getTime() + pomodoroRetryDelay(item.attempts + 1) };
    env.write(env.read(), true, env.readUnsaved().map((pending) => pending.id === item.id ? attempted : pending));
    // A failed lookup says nothing about whether this pomodoro is valid. Keep it for later.
    if (item.attempts > 0 && await env.hasSavedEntry(item.entry)) { remove(item.id); return; }
    if (closed || (signingOut && item.attempts > 0)) return;
    try {
      await env.createEntry({ ...item.entry, tags: [...item.entry.tags] });
    } catch (error) {
      if (!irrecoverablePomodoroError(error)) throw error;
      remove(item.id);
      env.message(error.message);
      return;
    }
    remove(item.id);
  };
  const samePhase = (a: PomodoroSessionState | null, b: PomodoroSessionState | null) =>
    a !== null && b !== null && a.id === b.id && a.revision === b.revision && !a.ending;

  // The caller holds the account lock through both the save and the replacement timer's POST.
  const finish = async (state: PomodoroSessionState, at: Date) => {
    if (state.ending) { env.write(null, true); return; }
    const item = snapshot(state, at);
    env.write({ ...state, ending: true }, true, [...env.readUnsaved(), ...(item ? [item] : [])]);
    try {
      if (item) await save(item, at);
    } finally {
      if (!closed) env.write(null);
    }
  };

  return {
    start(config: PomodoroSessionConfig, fields: EntryDraft): Promise<void> {
      const at = env.now();
      const phase = startSession(at);
      plannedEnd(phase, config);
      const state: PomodoroSessionState = {
        id: env.id(), revision: 0, config: { ...config }, fields: sessionFields(fields),
        phase, pomodoroStart: at.getTime(), ending: false,
      };
      return env.lock(async () => {
        if (closed || signingOut || env.read()) return;
        await env.beforeStart?.(at);
        if (!closed) env.write(state);
      });
    },
    startTimer<T extends { id: number }>(at: Date, create: () => Promise<T | null>, valid = () => true): Promise<T | null> {
      return timerLock(async () => {
        if (closed || !valid()) return null;
        const state = env.read();
        if (state) await finish(state, at);
        if (closed) return null;
        const entry = await create();
        if (entry) localTimers.set(entry.id, Math.floor(at.getTime() / 1000) * 1000);
        return entry;
      });
    },
    observeTimer(entry: { id: number; start: string }): Promise<void> {
      const at = new Date(entry.start);
      return env.lock(async () => {
        const state = env.read();
        if (closed || !state || localTimers.get(entry.id) === at.getTime() || at.getTime() <= state.pomodoroStart) return;
        await finish(state, at);
      });
    },
    pauseTimer(operation: () => Promise<void>): Promise<void> {
      return timerLock(async () => {
        // A session that won the lock has already stopped the timer and cleared its chain.
        if (!closed && !env.read()) await operation();
      });
    },
    nextPhase(expected = env.read()): Promise<void> {
      const at = env.now();
      return env.lock(async () => {
        const state = env.read();
        if (closed || !samePhase(state, expected) || !state) return;
        const change = nextPhase(state.phase, at, state.config);
        const completes = change.next.kind === 'work';
        const item = completes ? snapshot(state, at) : null;
        // The phase and its immutable ended span share one durable write before any POST.
        env.write({
          ...state, revision: state.revision + 1, phase: change.next,
          pomodoroStart: completes ? at.getTime() : state.pomodoroStart,
        }, completes, [...env.readUnsaved(), ...(item ? [item] : [])]);
        if (item) await save(item, at);
      });
    },
    end(forSignOut = false): Promise<void> {
      // Authentication cleanup makes one final save attempt, never drains the retry queue.
      if (forSignOut) signingOut = true;
      const at = env.now();
      const expected = env.read();
      return env.lock(async () => {
        const state = env.read();
        if (closed) return;
        try {
          if (state && state.id === expected?.id) await finish(state, at);
        } finally {
          if (forSignOut && !closed) env.write(null, true, []);
        }
      });
    },
    retry(force = false): Promise<void> {
      const at = env.now();
      const expected = env.readUnsaved();
      return env.lock(async () => {
        if (closed || signingOut) return;
        // Recover an End interrupted by a reload without ever recalculating its span.
        if (env.read()?.ending) env.write(null, true);
        for (const previous of expected) {
          if (closed || signingOut) return;
          const item = env.readUnsaved().find(({ id }) => id === previous.id);
          if (!item || item.attempts !== previous.attempts || (!force && item.retryAt > at.getTime())) continue;
          try { await save(item, at); } catch { /* Retain transient failures for the next wake-up. */ }
        }
      });
    },
    updateFields(changes: Partial<EntryDraft>): Promise<void> {
      const at = env.now();
      const expected = env.read();
      return env.lock(async () => {
        const state = env.read();
        if (closed || !state || state.ending || state.id !== expected?.id) return;
        if (at.getTime() < state.phase.startedAt.getTime()) throw new RangeError('Edit must not be before the phase start');
        env.write({ ...state, fields: sessionFields({ ...state.fields, ...changes }) });
      });
    },
    /** Invalidates queued operations when authentication ends or the account changes. */
    close() { closed = true; },
    activate() { closed = false; signingOut = false; },
  };
}
