import type { TimeEntry, TimerPause, TimerState } from '@tokkl/types';
import { t } from '../i18n/messages.ts';

export type TimerBarMode = 'running' | 'paused' | 'manual' | 'idle';

interface TimerBarView {
  mode: TimerBarMode;
  /** Null during a Pomodoro session, which the Pomodoro page owns. */
  current: TimeEntry | null;
  chain: TimerPause | null;
  paused: boolean;
  /** The manualMode preference picks it while idle. */
  manualMode: boolean;
}

/** A Pomodoro's open pomodoro is left to the Pomodoro page; a timer started here stops it and ends the session. */
export function timerBarView(timer: TimerState | undefined, manualModePreference: boolean): TimerBarView {
  const inSession = (timer?.pomodoro ?? null) !== null;
  const current = inSession ? null : (timer?.running_entry ?? null);
  const chain = timer?.pause ?? null;
  const paused = !current && chain?.paused === true;
  const manualMode = !current && !paused && manualModePreference;
  const mode: TimerBarMode = current ? 'running' : paused ? 'paused' : manualMode ? 'manual' : 'idle';
  return { mode, current, chain, paused, manualMode };
}

export function descriptionPlaceholder(mode: TimerBarMode): string {
  if (mode === 'manual') return t('timer.placeholderManual');
  if (mode === 'idle') return t('timer.placeholderIdle');
  return t('timer.placeholderRunning');
}

/** A resume continues the chain. */
export function pauseAnnouncement({ mode, chain, current }: TimerBarView): string {
  if (mode === 'paused') return t('timer.announcePaused');
  return chain && current && chain.clone_entry_id === current.id ? t('timer.announceResumed') : '';
}

export function timerBarClass(mode: TimerBarMode): string {
  return `timer-bar${mode === 'running' ? ' is-running' : mode === 'paused' ? ' is-paused' : ''}`;
}
