/**
 * A phase changes only when the user confirms Next phase. Pure: the caller passes every instant.
 * A pomodoro's entry runs to the next confirmed work start, unsnapped, so consecutive entries share a boundary.
 */

const MINUTE_MS = 60_000;

export type SessionPhaseKind = 'work' | 'shortRest' | 'longRest';

export type TransitionKind = 'workToShortRest' | 'shortRestToWork' | 'workToLongRest' | 'longRestToWork';

export interface PomodoroSessionConfig {
  /** Whole minutes, as are both rests. */
  workMinutes: number;
  shortRestMinutes: number;
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
  /** Work phases ended since the session start or the last long rest; a rest counts the work phase it follows. */
  completed: number;
}

export interface PhaseChange {
  next: SessionPhase;
  transition: TransitionKind;
  /** True when the phase was confirmed before its planned end. */
  skipped: boolean;
}

export function startSession(at: Date): SessionPhase {
  return { kind: 'work', startedAt: new Date(instant(at)), completed: 0 };
}

export function plannedEnd(phase: SessionPhase, config: PomodoroSessionConfig = DEFAULT_POMODORO_SESSION_CONFIG): Date {
  checkConfig(config);
  checkPhase(phase);
  return new Date(phase.startedAt.getTime() + phaseMinutes(phase.kind, config) * MINUTE_MS);
}

/**
 * A work phase that brings the count to `longRestEvery`, or past it after the setting was lowered,
 * is followed by a long rest; any other by a short rest. Every rest is followed by work.
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
 * A confirm before the planned end is a skip; an ended work phase counts toward the long rest either way.
 * The count restarts from zero after a long rest.
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
