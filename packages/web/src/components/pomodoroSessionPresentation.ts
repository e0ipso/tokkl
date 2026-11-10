import type { PomodoroPhaseKind, TimerState } from '@tokkl/types';
import { t, type MessageKey } from '../i18n/messages.ts';

const PHASE_LABEL = {
  work: 'pomodoro.phaseWork',
  shortRest: 'pomodoro.phaseShortRest',
  longRest: 'pomodoro.phaseLongRest',
} as const satisfies Record<PomodoroPhaseKind, MessageKey>;

export function phaseLabel(kind: PomodoroPhaseKind): string {
  return t(PHASE_LABEL[kind]);
}

/** Rounded up before `plannedEnd`, rounded down past it. */
export function countdown(plannedEnd: string, now: Date): { overtime: boolean; seconds: number } {
  const remaining = Date.parse(plannedEnd) - now.getTime();
  const overtime = remaining < 0;
  return { overtime, seconds: overtime ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000) };
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `now` is the server-corrected time. */
export function sessionTitle(pomodoro: NonNullable<TimerState['pomodoro']>, now: Date): string {
  const { overtime, seconds } = countdown(pomodoro.phase.planned_end, now);
  const parts = { phase: phaseLabel(pomodoro.phase.kind), clock: clock(seconds), app: t('shell.appName') };
  return overtime ? t('pomodoro.sessionTitleOvertime', parts) : t('pomodoro.sessionTitle', parts);
}

/** Once per discard this tab saw happen; the first state only records, so an earlier discard is not announced. */
export function createDiscardNotices(): (state: TimerState) => boolean {
  let seen: number | null | undefined;
  return state => {
    const id = state.discarded_pomodoro?.entry_id ?? null;
    const first = seen === undefined;
    const announce = !first && id !== null && id !== seen;
    if (first || id !== null) seen = id;
    return announce;
  };
}
