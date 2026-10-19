/**
 * The Pomodoro cycle: work phases separated by short breaks, with a long break after every few work
 * phases. These functions read no clock, keep no state and know nothing about stored preferences.
 * The caller passes the lengths, counts and instants, so other clients can port them as they are.
 *
 * Work time is the running time accrued in the current work phase, counted from the moment the
 * phase began. A pause freezes it and a resume continues from the same value. A break runs on
 * elapsed time from its start, whether or not a timer is running. All results in seconds can be
 * fractional when the instants carry milliseconds.
 */

const MINUTE_SECONDS = 60;
const SECOND_MS = 1000;

export type BreakKind = 'short' | 'long';

export interface PomodoroSettings {
  /** Length of a work phase, in whole minutes, at least 1. */
  workMinutes: number;
  /** Length of a short break, in whole minutes, at least 1. */
  shortBreakMinutes: number;
  /** Length of a long break, in whole minutes, at least 1. */
  longBreakMinutes: number;
  /** Number of work phases in a cycle; the last one is followed by a long break. At least 1. */
  longBreakEvery: number;
}

export const DEFAULT_POMODORO_SETTINGS: Readonly<PomodoroSettings> = Object.freeze({
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
});

export interface WorkPhase {
  /** Work seconds left, never below zero. */
  remainingSeconds: number;
  /** True once the accrued work time reaches the work length. */
  ended: boolean;
  /** When the phase ends, or ended, if the timer keeps running; null while paused. */
  endsAt: Date | null;
}

export interface NextBreak {
  kind: BreakKind;
  seconds: number;
}

export interface BreakPhase {
  /** Break seconds left, never below zero. */
  remainingSeconds: number;
  /** True once the elapsed time since the break started reaches its length. */
  ended: boolean;
  endsAt: Date;
}

export interface NextWorkPhase {
  /** The start of the work phase that follows the break: the break's end. */
  start: Date;
  /** The work seconds accrued in that phase at `now`. */
  workSeconds: number;
}

/**
 * What happened to the cycle. `workEnded` is a work phase that ran its full length, `workStopped`
 * is one abandoned by Stop, and `idle` asks whether the device has been idle too long at `now`.
 * `lastActiveAt` is the last instant the device had a running timer or a break.
 */
export type CycleEvent =
  | { type: 'workEnded' }
  | { type: 'workStopped' }
  | { type: 'breakEnded'; kind: BreakKind }
  | { type: 'idle'; lastActiveAt: Date; now: Date };

/**
 * The state of the current work phase after `workSeconds` of running time. An elapsed time equal
 * to the work length counts as ended. While the timer runs, `endsAt` is the instant the accrued
 * time reaches the work length, which is in the past once the phase has run over.
 */
export function workPhase(
  workSeconds: number,
  running: boolean,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): WorkPhase {
  checkSettings(settings);
  if (!(Number.isFinite(workSeconds) && workSeconds >= 0)) throw new RangeError(`Invalid work seconds: ${workSeconds}`);
  const left = settings.workMinutes * MINUTE_SECONDS - workSeconds;
  return {
    remainingSeconds: Math.max(0, left),
    ended: left <= 0,
    endsAt: running ? new Date(instant(now) + left * SECOND_MS) : null,
  };
}

/**
 * The break that follows the current work phase, given the `completed` work phases before it. The
 * phase that brings the count up to `longBreakEvery` is followed by a long break, and so is any
 * phase after that, when the setting was lowered below the count. Any other gets a short break.
 */
export function nextBreak(completed: number, settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS): NextBreak {
  checkSettings(settings);
  checkCount(completed);
  const kind: BreakKind = completed + 1 >= settings.longBreakEvery ? 'long' : 'short';
  return { kind, seconds: breakSeconds(kind, settings) };
}

/** The state of a break of `kind` that started at `startedAt`. A `now` before the start counts as no time elapsed. */
export function breakPhase(
  kind: BreakKind,
  startedAt: Date,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): BreakPhase {
  checkSettings(settings);
  const length = breakSeconds(kind, settings);
  const elapsed = Math.max(0, (instant(now) - instant(startedAt)) / SECOND_MS);
  return {
    remainingSeconds: Math.max(0, length - elapsed),
    ended: elapsed >= length,
    endsAt: new Date(instant(startedAt) + length * SECOND_MS),
  };
}

/**
 * The work phase that a break of `kind` hands over to when it ends while the timer still runs,
 * which happens when the timer does not stop at the end of a phase. The phase starts at the break's
 * end and its work time counts from there. Null while the break has not ended or when no timer runs.
 */
export function nextWorkPhase(
  kind: BreakKind,
  startedAt: Date,
  running: boolean,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): NextWorkPhase | null {
  const { ended, endsAt } = breakPhase(kind, startedAt, now, settings);
  if (!running || !ended) return null;
  return { start: endsAt, workSeconds: (instant(now) - endsAt.getTime()) / SECOND_MS };
}

/**
 * The completed work phase count after `event`. A finished work phase adds one and an abandoned one
 * leaves the count as it was. The count goes back to zero when a long break ends, and when the
 * device has been idle for longer than the long-break length; idle for exactly that length keeps it.
 */
export function nextCompletedCount(
  completed: number,
  event: CycleEvent,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): number {
  checkSettings(settings);
  checkCount(completed);
  switch (event.type) {
    case 'workEnded':
      return completed + 1;
    case 'workStopped':
      return completed;
    case 'breakEnded':
      checkKind(event.kind);
      return event.kind === 'long' ? 0 : completed;
    case 'idle': {
      const idleSeconds = (instant(event.now) - instant(event.lastActiveAt)) / SECOND_MS;
      return idleSeconds > settings.longBreakMinutes * MINUTE_SECONDS ? 0 : completed;
    }
    default:
      throw new RangeError(`Invalid cycle event: ${(event as { type: unknown }).type}`);
  }
}

function breakSeconds(kind: BreakKind, settings: PomodoroSettings): number {
  checkKind(kind);
  return (kind === 'long' ? settings.longBreakMinutes : settings.shortBreakMinutes) * MINUTE_SECONDS;
}

function checkKind(kind: BreakKind): void {
  if (kind !== 'short' && kind !== 'long') throw new RangeError(`Invalid break kind: ${String(kind)}`);
}

function checkSettings(settings: PomodoroSettings): void {
  for (const key of ['workMinutes', 'shortBreakMinutes', 'longBreakMinutes', 'longBreakEvery'] as const) {
    const value = settings[key];
    if (!(Number.isInteger(value) && value >= 1)) throw new RangeError(`Invalid ${key}: ${value}`);
  }
}

function checkCount(completed: number): void {
  if (!(Number.isInteger(completed) && completed >= 0)) throw new RangeError(`Invalid completed count: ${completed}`);
}

function instant(date: Date): number {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError('Invalid date');
  return time;
}
