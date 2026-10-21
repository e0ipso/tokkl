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
}

/** Plain TS so the clock, storage, lock and request can all be supplied by a caller. */
export function createPomodoroSessionController(env: SessionEnvironment) {
  let closed = false;
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
        if (!closed && !env.read()) env.write(state);
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
        if (state.ending) { env.write(null); return; }
        // Leave the claimed session stored until the save settles, including on sign-out.
        env.write({ ...state, ending: true }, true);
        try {
          await save(state, at);
        } finally {
          if (!closed) env.write(null);
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
    activate() { closed = false; },
  };
}
