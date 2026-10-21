import { plannedEnd, transitionKind, type PomodoroSessionConfig, type SessionPhase } from '@tokkl/common/pomodoroSession';
import type { EntryDraft } from './useEntryFields.ts';

export interface PomodoroSessionState {
  id: string;
  revision: number;
  config: PomodoroSessionConfig;
  fields: EntryDraft;
  phase: SessionPhase;
  /** The exact work start, retained through its rest. */
  pomodoroStart: number;
  /** The current pomodoro was claimed for an End save, which must never be replayed. */
  ending: boolean;
}

const PREFIX = 'tokkl.pomodoroSession.';
export const pomodoroSessionKey = (accountId: number): string => `${PREFIX}${accountId}`;

export function sessionText(state: PomodoroSessionState): string {
  return JSON.stringify({ version: 1, ...state, phase: { ...state.phase, startedAt: state.phase.startedAt.getTime() } });
}

/** Read only our own version and fields. A broken or future record is no session. */
export function parsePomodoroSession(text: string | null): PomodoroSessionState | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id
      || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.ending !== 'boolean') return null;
    const { config, phase, fields } = value;
    if (!config || !phase || !fields || typeof phase.startedAt !== 'number'
      || !Number.isFinite(phase.startedAt) || typeof value.pomodoroStart !== 'number'
      || !Number.isFinite(value.pomodoroStart) || value.pomodoroStart > phase.startedAt
      || (phase.kind === 'work' && value.pomodoroStart !== phase.startedAt)
      || Number.isNaN(new Date(value.pomodoroStart).getTime())) return null;
    const parsedPhase: SessionPhase = { kind: phase.kind, completed: phase.completed, startedAt: new Date(phase.startedAt) };
    const parsedConfig: PomodoroSessionConfig = {
      workMinutes: config.workMinutes, shortRestMinutes: config.shortRestMinutes,
      longRestMinutes: config.longRestMinutes, longRestEvery: config.longRestEvery,
    };
    plannedEnd(parsedPhase, parsedConfig);
    transitionKind(parsedPhase, parsedConfig);
    const parsedFields = sessionFields(fields);
    return {
      id: value.id, revision: value.revision, config: parsedConfig, fields: parsedFields,
      phase: parsedPhase, pomodoroStart: value.pomodoroStart, ending: value.ending,
    };
  } catch {
    return null;
  }
}

/** Whitelist entry fields, including for callers that supply additional entry properties. */
export function sessionFields(fields: EntryDraft): EntryDraft {
  const ref = (id: unknown) => id === null || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
  if (typeof fields.description !== 'string' || !ref(fields.project_id) || !ref(fields.task_id)
    || typeof fields.billable !== 'boolean' || !Array.isArray(fields.tags)
    || !fields.tags.every((tag: unknown) => typeof tag === 'string')) throw new TypeError('Invalid Pomodoro entry fields');
  return {
    description: fields.description, project_id: fields.project_id, task_id: fields.task_id,
    tags: [...fields.tags], billable: fields.billable,
  };
}

/** The same blocked/full-storage fallback used by the paused timer: a foreign write wins. */
export function createPomodoroSessionStorage(accountId: number, storage: () => Storage) {
  const key = pomodoroSessionKey(accountId);
  let memory: PomodoroSessionState | null = null;
  let refused: { over: string | null } | undefined;
  let shared = false;
  const read = (): PomodoroSessionState | null => {
    try {
      const text = storage().getItem(key);
      if (refused && refused.over === text) return memory;
      memory = parsePomodoroSession(text);
      refused = undefined;
      shared = memory !== null;
    } catch {
      // Keep the tab's copy until storage is accessible again.
    }
    return memory;
  };
  const write = (state: PomodoroSessionState | null, claim = false): void => {
    let over: string | null = null;
    try {
      over = storage().getItem(key);
      if (state) storage().setItem(key, sessionText(state));
      else storage().removeItem(key);
      refused = undefined;
      shared = state !== null;
    } catch {
      // A shared pomodoro needs a durable claim before any request. Otherwise another tab or a
      // reload could send it again. A session created only in memory has no other tab to replay it.
      if (claim && shared) throw new Error('Free some browser storage before saving this Pomodoro session.');
      refused = { over };
    }
    memory = state;
  };
  return { read, write, forget: () => { memory = null; refused = undefined; shared = false; } };
}

export function forgetPomodoroSessions(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
