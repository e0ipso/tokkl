/**
 * The Pomodoro in the timer bar: the work phase, the break and the completed count on this device.
 * `advance` moves the cycle to `now` from what the timer bar shows, using the clock-free rules in
 * @tokkl/common/pomodoro. Every countdown comes from stored instants and `now`, never from ticks,
 * so a throttled background tab still shows the right time when it wakes.
 *
 * Plain TypeScript with no React or DOM, so node:test can load it.
 */

import {
  DEFAULT_POMODORO_SETTINGS, breakPhase, nextBreak, nextCompletedCount, nextWorkPhase, workPhase,
  type BreakKind, type PomodoroSettings,
} from '@tokkl/common/pomodoro';

/**
 * A work phase accrues running time from `since`; `accruedMs` holds its earlier running spans.
 * `since` is null while the timer is paused, which freezes the phase. Instants are in ms.
 * `entryId` is the running entry the phase last followed, or null when it is not known yet.
 */
export interface WorkState {
  type: 'work';
  start: number;
  accruedMs: number;
  since: number | null;
  entryId: number | null;
}

/** A break runs on elapsed time from `start`, whether or not a timer runs. */
export interface BreakState {
  type: 'break';
  kind: BreakKind;
  start: number;
}

/** What ended: a work phase, or a short or long break. */
export type PhaseEnd = 'work' | BreakKind;

export interface PomodoroState {
  /** Work phases completed in the current cycle. */
  completed: number;
  /** The current phase; null between phases, until a timer runs. */
  phase: WorkState | BreakState | null;
  /** The last instant this device had a running work phase or a break, in ms. */
  lastActiveAt: number | null;
  /** The phase end the banner shows until it is dismissed. */
  banner: PhaseEnd | null;
}

export const IDLE_STATE: PomodoroState = Object.freeze({ completed: 0, phase: null, lastActiveAt: null, banner: null });

/**
 * What the timer shows. `entryId` is the running entry, or null when none runs. `resumed` says the
 * running entry is the pause chain's clone, started by Resume. `paused` is a pause chain waiting
 * for Resume, which Stop would end, and `pausedAt` is when that pause began, if known.
 */
export interface TimerView {
  entryId: number | null;
  resumed: boolean;
  paused: boolean;
  pausedAt: number | null;
}

export interface Advance {
  state: PomodoroState;
  /** Whether a phase ended, so the bell rings. It rings once however many phases ended. */
  rang: boolean;
  /** Whether a work phase ended while the timer ran, which pauses the entry when stop-at-end is on. */
  workEnded: boolean;
}

/** The Pomodoro preferences the timer bar reads, as the API stores them. */
export interface PomodoroPreferences {
  pomodoro_enabled?: unknown;
  pomodoro_focus_interval_in_minutes?: unknown;
  pomodoro_break_interval_in_minutes?: unknown;
  pomodoro_long_break_interval_in_minutes?: unknown;
  pomodoro_long_break_every?: unknown;
  pomodoro_stop_timer_at_end?: unknown;
}

export interface PomodoroConfig {
  settings: PomodoroSettings;
  stopAtEnd: boolean;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** Each pass ends a phase of at least a minute, so this covers more than a day away. */
const MAX_PASSES = 5000;

function whole(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

/** The cycle settings, or null when the Pomodoro is off. Values that are not whole minutes fall back to the defaults. */
export function pomodoroConfig(prefs: PomodoroPreferences | undefined): PomodoroConfig | null {
  if (!prefs || prefs.pomodoro_enabled !== true) return null;
  const d = DEFAULT_POMODORO_SETTINGS;
  return {
    settings: {
      workMinutes: whole(prefs.pomodoro_focus_interval_in_minutes, d.workMinutes),
      shortBreakMinutes: whole(prefs.pomodoro_break_interval_in_minutes, d.shortBreakMinutes),
      longBreakMinutes: whole(prefs.pomodoro_long_break_interval_in_minutes, d.longBreakMinutes),
      longBreakEvery: whole(prefs.pomodoro_long_break_every, d.longBreakEvery),
    },
    stopAtEnd: prefs.pomodoro_stop_timer_at_end !== false,
  };
}

/** Work time accrued in `work` at `now`, in ms. */
function accruedAt(work: WorkState, now: number): number {
  return work.accruedMs + (work.since === null ? 0 : Math.max(0, now - work.since));
}

/** When a running work phase reaches its length, in ms. */
function workEndsAt(work: WorkState & { since: number }, settings: PomodoroSettings): number {
  return work.since + settings.workMinutes * MINUTE_MS - work.accruedMs;
}

/**
 * The cycle at `now`. A running timer with no phase begins a work phase, after the count resets
 * for a long idle spell. A work phase that reaches its length starts the break that `nextBreak`
 * picks, from the instant it ended. With stop-at-end on, the cycle treats the timer as stopped from
 * there, because the caller pauses the entry. A pause freezes the work phase at the moment it
 * began, and Resume continues it. Stop abandons it and keeps the count, and so does any other
 * entry that starts running in its place, which then begins a fresh phase. A break that ends while
 * the timer runs hands over to a work phase that starts at the break's end; otherwise the next
 * phase waits for a running timer.
 */
export function advance(state: PomodoroState, timer: TimerView, now: number, config: PomodoroConfig): Advance {
  const { settings, stopAtEnd } = config;
  const at = new Date(now);
  let running = timer.entryId !== null;
  const entryId = timer.entryId;
  let next = state;
  let rang = false;
  let workEnded = false;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const phase = next.phase;
    if (phase?.type === 'work') {
      // Another entry took over, not the chain's clone: its work starts a phase of its own.
      const replaced = running && phase.entryId !== null && entryId !== phase.entryId && !timer.resumed;
      if (phase.since !== null) {
        // A pause stops the work time when it began, not when the stop's answer arrived.
        const until = !running && timer.paused && timer.pausedAt !== null ? Math.min(now, Math.max(phase.since, timer.pausedAt)) : now;
        const accruedMs = accruedAt(phase, until);
        if (workPhase(accruedMs / SECOND_MS, true, new Date(until), settings).ended) {
          const endedAt = workEndsAt({ ...phase, since: phase.since }, settings);
          const coming = nextBreak(next.completed, settings);
          next = {
            completed: nextCompletedCount(next.completed, { type: 'workEnded' }, settings),
            phase: { type: 'break', kind: coming.kind, start: endedAt },
            lastActiveAt: endedAt,
            banner: 'work',
          };
          rang = true;
          if (running) workEnded = true;
          if (stopAtEnd) running = false;
          continue;
        }
        if (replaced) {
          next = abandoned(next, now, settings);
          continue;
        }
        if (running) {
          if (phase.entryId !== entryId) next = { ...next, phase: { ...phase, entryId } };
          break;
        }
        next = timer.paused
          ? { ...next, phase: { ...phase, accruedMs, since: null } }
          : abandoned(next, now, settings);
        break;
      }
      if (replaced) {
        next = abandoned(next, now, settings);
        continue;
      }
      if (running) next = { ...next, phase: { ...phase, since: now, entryId } };
      else if (!timer.paused) next = abandoned(next, now, settings);
      break;
    }
    if (phase?.type === 'break') {
      const breakNow = breakPhase(phase.kind, new Date(phase.start), at, settings);
      if (!breakNow.ended) break;
      const endedAt = breakNow.endsAt.getTime();
      const work = nextWorkPhase(phase.kind, new Date(phase.start), running, at, settings);
      next = {
        completed: nextCompletedCount(next.completed, { type: 'breakEnded', kind: phase.kind }, settings),
        phase: work ? { type: 'work', start: endedAt, accruedMs: 0, since: endedAt, entryId } : null,
        lastActiveAt: endedAt,
        banner: phase.kind,
      };
      rang = true;
      continue;
    }
    if (running) {
      const completed = next.lastActiveAt === null
        ? next.completed
        : nextCompletedCount(next.completed, { type: 'idle', lastActiveAt: new Date(next.lastActiveAt), now: at }, settings);
      next = { ...next, completed, phase: { type: 'work', start: now, accruedMs: 0, since: now, entryId } };
    }
    break;
  }
  return { state: next, rang, workEnded };
}

function abandoned(state: PomodoroState, now: number, settings: PomodoroSettings): PomodoroState {
  return { ...state, completed: nextCompletedCount(state.completed, { type: 'workStopped' }, settings), phase: null, lastActiveAt: now };
}

/** The next instant the cycle changes on its own, in ms: the end of a running work phase or of the break. */
export function nextDeadline(state: PomodoroState, settings: PomodoroSettings): number | null {
  const phase = state.phase;
  if (phase?.type === 'break') return breakPhase(phase.kind, new Date(phase.start), new Date(phase.start), settings).endsAt.getTime();
  if (phase?.type === 'work' && phase.since !== null) return workEndsAt({ ...phase, since: phase.since }, settings);
  return null;
}

export interface Countdown {
  phase: 'work' | BreakKind;
  /** Whole seconds left, rounded up, so it reads 0:00 only once the phase has ended. */
  seconds: number;
}

/** The countdown the timer bar shows at `now`, or null between phases. */
export function countdown(state: PomodoroState, now: number, settings: PomodoroSettings): Countdown | null {
  const phase = state.phase;
  if (phase?.type === 'work') {
    const left = workPhase(accruedAt(phase, now) / SECOND_MS, phase.since !== null, new Date(now), settings).remainingSeconds;
    return { phase: 'work', seconds: Math.ceil(left) };
  }
  if (phase?.type === 'break') {
    return { phase: phase.kind, seconds: Math.ceil(breakPhase(phase.kind, new Date(phase.start), new Date(now), settings).remainingSeconds) };
  }
  return null;
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function countdownText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The subset of Storage the state uses, so tests can pass a stand-in. */
export interface PomodoroStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

const KEY_PREFIX = 'tokkl.pomodoro.';
const VERSION = 1;

/** The localStorage key for one account, so another account on the same browser never sees it. */
export function pomodoroKey(accountId: number): string {
  return `${KEY_PREFIX}${accountId}`;
}

function isInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePhase(value: unknown): WorkState | BreakState | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  const entryId = p.entryId === undefined || p.entryId === null ? null : p.entryId;
  if (p.type === 'work' && isInstant(p.start) && isInstant(p.accruedMs) && p.accruedMs >= 0 && (p.since === null || isInstant(p.since))
    && (entryId === null || (typeof entryId === 'number' && Number.isInteger(entryId) && entryId > 0))) {
    return { type: 'work', start: p.start, accruedMs: p.accruedMs, since: p.since, entryId };
  }
  if (p.type === 'break' && (p.kind === 'short' || p.kind === 'long') && isInstant(p.start)) {
    return { type: 'break', kind: p.kind, start: p.start };
  }
  return undefined;
}

/** Reads stored state; anything unreadable counts as a fresh cycle. */
export function parseState(text: string | null): PomodoroState {
  if (text === null) return IDLE_STATE;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return IDLE_STATE;
  }
  if (typeof data !== 'object' || data === null) return IDLE_STATE;
  const { v, completed, phase, lastActiveAt, banner } = data as Record<string, unknown>;
  const parsed = parsePhase(phase);
  if (v !== VERSION || !(typeof completed === 'number' && Number.isInteger(completed) && completed >= 0) || parsed === undefined) return IDLE_STATE;
  if (!(lastActiveAt === null || isInstant(lastActiveAt))) return IDLE_STATE;
  if (!(banner === null || banner === 'work' || banner === 'short' || banner === 'long')) return IDLE_STATE;
  return { completed, phase: parsed, lastActiveAt, banner };
}

export function serializeState(state: PomodoroState): string {
  return JSON.stringify({ v: VERSION, ...state });
}

/** The account's stored text, null when nothing is stored, or undefined when storage is blocked. */
export function readStored(storage: PomodoroStorage, accountId: number): string | null | undefined {
  try {
    return storage.getItem(pomodoroKey(accountId));
  } catch {
    return undefined;
  }
}

/**
 * Stores the account's state, or removes it once nothing is left to keep, and returns what is now
 * stored. Undefined means storage refused the write; the state then lasts until the page reloads.
 */
export function writeStored(storage: PomodoroStorage, accountId: number, state: PomodoroState): string | null | undefined {
  try {
    if (sameState(state, IDLE_STATE)) {
      storage.removeItem(pomodoroKey(accountId));
      return null;
    }
    const text = serializeState(state);
    storage.setItem(pomodoroKey(accountId), text);
    return text;
  } catch {
    return undefined;
  }
}

export function sameState(a: PomodoroState, b: PomodoroState): boolean {
  return serializeState(a) === serializeState(b);
}

/** Removes every account's state, for sign-out. */
export function forgetPomodoro(storage: PomodoroStorage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage can be blocked; then there is nothing stored to forget.
  }
}
