import { nextPhase, plannedEnd, pomodoroEntrySpan, startSession, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { TimeEntryInput } from '../api/types.ts';
import type { EntryDraft } from './useEntryFields.ts';
import { sessionFields, type PomodoroSessionState } from './pomodoroSessionState.ts';

export interface SessionEnvironment {
  read: () => PomodoroSessionState | null;
  write: (state: PomodoroSessionState | null, claim?: boolean) => void;
  lock: <T>(run: () => Promise<T>) => Promise<T>;
  now: () => Date;
  id: () => string;
  grid: () => { minutes: number; timeZone: string };
  createEntry: (entry: TimeEntryInput) => Promise<unknown>;
  message: (message: string) => void;
  beforeStart?: (at: Date) => Promise<void>;
  timerLock?: <T>(run: () => Promise<T>) => Promise<T>;
}

/** Plain TS so the clock, storage, lock and request can all be supplied by a caller. */
export function createPomodoroSessionController(env: SessionEnvironment) {
  let closed = false;
  const localTimers = new Map<number, number>();
  const timerLock = env.timerLock ?? env.lock;
  const save = async (state: PomodoroSessionState, at: Date) => {
    const { minutes, timeZone } = env.grid();
    const span = pomodoroEntrySpan(new Date(state.pomodoroStart), at, minutes, timeZone);
    if (!span) {
      env.message('This pomodoro was too short to save.');
      return;
    }
    await env.createEntry({
      ...sessionFields(state.fields), start: span.start.toISOString(), stop: span.stop.toISOString(),
      duration: (span.stop.getTime() - span.start.getTime()) / 1000,
    });
  };
  const samePhase = (a: PomodoroSessionState | null, b: PomodoroSessionState | null) =>
    a !== null && b !== null && a.id === b.id && a.revision === b.revision && !a.ending;

  // The caller holds the account lock through both the save and the replacement timer's POST.
  const finish = async (state: PomodoroSessionState, at: Date) => {
    if (state.ending) { env.write(null); return; }
    env.write({ ...state, ending: true }, true);
    try {
      await save(state, at);
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
        if (closed || env.read()) return;
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
        // Publishing the new phase is also the save claim. A crash or a failed request must not
        // cause a second POST. Retrying failed saves is a separate responsibility.
        env.write({
          ...state, revision: state.revision + 1, phase: change.next,
          pomodoroStart: completes ? at.getTime() : state.pomodoroStart,
        }, completes);
        if (completes) await save(state, at);
      });
    },
    end(): Promise<void> {
      const at = env.now();
      const expected = env.read();
      return env.lock(async () => {
        const state = env.read();
        if (closed || !state || state.id !== expected?.id) return;
        await finish(state, at);
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
    activate() { closed = false; },
  };
}
