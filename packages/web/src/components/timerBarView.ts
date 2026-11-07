import type { TimeEntry, TimerPause, TimerState } from '../api/types.ts';
import { t } from '../i18n/messages.ts';

/** The timer bar's modes: a running timer, a paused chain, the manual form, or the idle timer. */
export type TimerBarMode = 'running' | 'paused' | 'manual' | 'idle';

/** What the timer bar shows for a timer state. */
export interface TimerBarView {
  mode: TimerBarMode;
  /** The running entry the bar shows; null during a Pomodoro session, which the Pomodoro page owns. */
  current: TimeEntry | null;
  /** The pause chain, paused or resumed. */
  chain: TimerPause | null;
  paused: boolean;
  /** Whether the manual form shows, which the account's manualMode preference picks while idle. */
  manualMode: boolean;
}

/**
 * The bar's mode. A Pomodoro session's open pomodoro is the running entry; the bar leaves it to the
 * Pomodoro page and shows its idle form, and a timer started there stops the pomodoro, which ends
 * the session.
 */
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

/** What the bar's live region says: a pause, or a resume (the running entry continues the chain). */
export function pauseAnnouncement({ mode, chain, current }: TimerBarView): string {
  if (mode === 'paused') return t('timer.announcePaused');
  return chain && current && chain.clone_entry_id === current.id ? t('timer.announceResumed') : '';
}

export function timerBarClass(mode: TimerBarMode): string {
  return `timer-bar${mode === 'running' ? ' is-running' : mode === 'paused' ? ' is-paused' : ''}`;
}
