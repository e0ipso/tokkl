/**
 * The Pomodoro session: work phases separated by short rests, with a long rest after every few work
 * phases. Unlike the timer-tied cycle in pomodoro.ts, a phase changes only when the user confirms
 * Next phase. Confirming before the planned end skips the rest of the phase, and a phase confirmed
 * after its planned end has run overtime. The user can end the session at any time.
 *
 * These functions read no clock, keep no state and know nothing about stored preferences. The
 * caller passes every instant, so other clients can port them as they are. Results in seconds can
 * be fractional when the instants carry milliseconds.
 *
 * A pomodoro is a work phase plus the rest after it. Its time entry runs from the work start to the
 * next confirmed work start, or to the instant the session ends. The next pomodoro starts at the
 * previous one's exact, unsnapped end, so their snapped entries share a boundary.
 */

import { snapSpan, type SnappedSpan } from './snap.ts';

const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

export type SessionPhaseKind = 'work' | 'shortRest' | 'longRest';

export type TransitionKind = 'workToShortRest' | 'shortRestToWork' | 'workToLongRest' | 'longRestToWork';

export interface PomodoroSessionConfig {
  /** Length of a work phase, in whole minutes. */
  workMinutes: number;
  /** Length of a short rest, in whole minutes. */
  shortRestMinutes: number;
  /** Length of a long rest, in whole minutes. */
  longRestMinutes: number;
  /** A long rest follows every this many ended work phases. */
  longRestEvery: number;
}

export interface ConfigRange {
  min: number;
  max: number;
}

export const DEFAULT_POMODORO_SESSION_CONFIG: Readonly<PomodoroSessionConfig> = Object.freeze({
  workMinutes: 25,
  shortRestMinutes: 5,
  longRestMinutes: 15,
  longRestEvery: 4,
});

/** The inclusive range of whole numbers each config value accepts. */
export const POMODORO_SESSION_CONFIG_RANGES: Readonly<Record<keyof PomodoroSessionConfig, Readonly<ConfigRange>>> =
  Object.freeze({
    workMinutes: Object.freeze({ min: 1, max: 180 }),
    shortRestMinutes: Object.freeze({ min: 1, max: 60 }),
    longRestMinutes: Object.freeze({ min: 1, max: 60 }),
    longRestEvery: Object.freeze({ min: 1, max: 12 }),
  });

export interface SessionPhase {
  kind: SessionPhaseKind;
  /** When the phase started: the session start or the instant the previous phase was confirmed. */
  startedAt: Date;
  /**
   * Work phases ended since the session started or the last long rest ended. A work phase counts
   * the ones before it; a rest counts the work phase it follows.
   */
  completed: number;
}

export interface PhaseChange {
  next: SessionPhase;
  transition: TransitionKind;
  /** True when the phase was confirmed before its planned end. */
  skipped: boolean;
}

/** The first phase of a session started at `at`: a work phase with no ended work phases before it. */
export function startSession(at: Date): SessionPhase {
  return { kind: 'work', startedAt: new Date(instant(at)), completed: 0 };
}

/** The instant `phase` reaches its planned length. */
export function plannedEnd(phase: SessionPhase, config: PomodoroSessionConfig = DEFAULT_POMODORO_SESSION_CONFIG): Date {
  checkConfig(config);
  checkPhase(phase);
  return new Date(phase.startedAt.getTime() + phaseMinutes(phase.kind, config) * MINUTE_MS);
}

/** Seconds `phase` has run past its planned end at `at`, or zero until then. */
export function overtimeSeconds(
  phase: SessionPhase,
  at: Date,
  config: PomodoroSessionConfig = DEFAULT_POMODORO_SESSION_CONFIG,
): number {
  const over = instant(at) - plannedEnd(phase, config).getTime();
  return Math.max(0, over / SECOND_MS);
}

/**
 * The transition that ends `phase`. A work phase that brings the count up to `longRestEvery`, or
 * past it after the setting was lowered, is followed by a long rest; any other by a short rest.
 * Every rest is followed by work.
 */
export function transitionKind(
  phase: SessionPhase,
  config: PomodoroSessionConfig = DEFAULT_POMODORO_SESSION_CONFIG,
): TransitionKind {
  checkConfig(config);
  checkPhase(phase);
  switch (phase.kind) {
    case 'work':
      return phase.completed + 1 >= config.longRestEvery ? 'workToLongRest' : 'workToShortRest';
    case 'shortRest':
      return 'shortRestToWork';
    default:
      return 'longRestToWork';
  }
}

/**
 * The phase that starts when the user confirms Next phase at `at`. A confirm before the planned end
 * is a skip; an ended work phase counts toward the long rest whether skipped or not. The count
 * starts again from zero after a long rest.
 */
export function nextPhase(
  phase: SessionPhase,
  at: Date,
  config: PomodoroSessionConfig = DEFAULT_POMODORO_SESSION_CONFIG,
): PhaseChange {
  const transition = transitionKind(phase, config);
  const confirmedAt = instant(at);
  if (confirmedAt < phase.startedAt.getTime()) throw new RangeError('Confirm must not be before the phase start');
  const startedAt = new Date(confirmedAt);
  const skipped = confirmedAt < plannedEnd(phase, config).getTime();
  const next: SessionPhase =
    transition === 'workToShortRest'
      ? { kind: 'shortRest', startedAt, completed: phase.completed + 1 }
      : transition === 'workToLongRest'
        ? { kind: 'longRest', startedAt, completed: phase.completed + 1 }
        : { kind: 'work', startedAt, completed: transition === 'longRestToWork' ? 0 : phase.completed };
  return { next, transition, skipped };
}

/**
 * The time entry of a pomodoro that started at `start` and ended at `end`, snapped to a resolution
 * of `minutes` on the wall clock of `timeZone`. Each end moves to the nearest grid point, the later
 * one on a tie. Null when `snapSpan` drops the span, including when both ends snap to one point.
 */
export function pomodoroEntrySpan(start: Date, end: Date, minutes: number, timeZone: string): SnappedSpan | null {
  return snapSpan(start, end, minutes, timeZone);
}

function phaseMinutes(kind: SessionPhaseKind, config: PomodoroSessionConfig): number {
  if (kind === 'work') return config.workMinutes;
  return kind === 'shortRest' ? config.shortRestMinutes : config.longRestMinutes;
}

function checkConfig(config: PomodoroSessionConfig): void {
  for (const key of Object.keys(POMODORO_SESSION_CONFIG_RANGES) as (keyof PomodoroSessionConfig)[]) {
    const value = config[key];
    const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
    if (!(Number.isInteger(value) && value >= min && value <= max)) throw new RangeError(`Invalid ${key}: ${value}`);
  }
}

function checkPhase(phase: SessionPhase): void {
  const { kind, completed } = phase;
  if (kind !== 'work' && kind !== 'shortRest' && kind !== 'longRest') {
    throw new RangeError(`Invalid phase kind: ${String(kind)}`);
  }
  if (!(Number.isInteger(completed) && completed >= 0)) throw new RangeError(`Invalid completed count: ${completed}`);
  instant(phase.startedAt);
}

function instant(date: Date): number {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError('Invalid date');
  return time;
}
