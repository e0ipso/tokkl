import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { notifyPhaseEnd } from './phaseNotification.ts';
import {
  IDLE_STATE, advance, countdown, nextDeadline, parseState, pomodoroConfig, pomodoroKey, readStored, sameState, writeStored,
  type Countdown, type PhaseEnd, type PomodoroPreferences, type PomodoroState, type TimerView,
} from './pomodoroCycle.ts';

/** Same-origin, because the CSP falls back to default-src 'self' for media. */
const BELL_URL = '/sounds/pomodoro-bell.mp3';
/** setTimeout's longest delay; a later deadline waits for another timeout. */
const MAX_DELAY_MS = 2 ** 31 - 1;

let bell: HTMLAudioElement | null = null;

/**
 * Plays the bell once. The browser's autoplay policy can reject play(), and a page without audio
 * support can throw; the banner shows either way, so both are ignored.
 */
function ring(): void {
  try {
    if (!bell) {
      bell = new Audio();
      // Loads on the first ring rather than with the page.
      bell.preload = 'none';
      bell.src = BELL_URL;
    }
    bell.currentTime = 0;
    bell.play()?.catch(() => undefined);
  } catch {
    // No audio here; the banner still says the phase ended.
  }
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface Pomodoro {
  /** The countdown at `now`, or null when the Pomodoro is off or between phases. */
  countdown: (now: number) => Countdown | null;
  /** The phase end the banner shows, or null. */
  banner: PhaseEnd | null;
  dismiss: () => void;
}

interface Options {
  accountId: number;
  prefs: PomodoroPreferences | undefined;
  /** True while a preference save is pending, when `prefs` may hold a value that rolls back. */
  prefsSaving: boolean;
  /** Whether a timer runs or is paused, or null while the running entry has not loaded. */
  timer: TimerView | null;
  /** True while a pause or resume is in flight, when the running entry is about to change. */
  busy: RefObject<boolean>;
  /** Called when a work phase ends with stop-at-end on, so the caller pauses the running entry. */
  onWorkEnded: () => void;
}

/**
 * Runs the Pomodoro cycle. It lives in localStorage per account, so a reload and the account's
 * other tabs keep it, and it moves on whenever the caller renders and at each deadline.
 */
export function usePomodoro({ accountId, prefs, prefsSaving, timer, busy, onWorkEnded }: Options): Pomodoro {
  const config = useMemo(() => pomodoroConfig(prefs), [
    prefs?.pomodoro_enabled, prefs?.pomodoro_focus_interval_in_minutes, prefs?.pomodoro_break_interval_in_minutes,
    prefs?.pomodoro_long_break_interval_in_minutes, prefs?.pomodoro_long_break_every, prefs?.pomodoro_stop_timer_at_end,
  ]);
  const [state, setState] = useState<PomodoroState>(IDLE_STATE);
  const stateRef = useRef(state);
  // The stored text this tab last read or wrote. Different text means another tab moved the cycle on.
  const seen = useRef<string | null | undefined>(undefined);
  const [, setWake] = useState(0);

  const sync = (): PomodoroState => {
    const storage = localStore();
    const text = storage && accountId ? readStored(storage, accountId) : undefined;
    if (text !== undefined && text !== seen.current) {
      seen.current = text;
      const next = parseState(text);
      stateRef.current = next;
      setState(next);
    }
    return stateRef.current;
  };

  const store = (next: PomodoroState) => {
    if (sameState(next, stateRef.current)) return;
    stateRef.current = next;
    setState(next);
    const storage = localStore();
    const written = storage && accountId ? writeStored(storage, accountId, next) : undefined;
    if (written !== undefined) seen.current = written;
  };

  // Another account signed in, or the account loaded: start from its stored cycle.
  useEffect(() => {
    seen.current = undefined;
    stateRef.current = IDLE_STATE;
    setState(IDLE_STATE);
    sync();
  }, [accountId]);

  // Another tab of this account moved the cycle on or dismissed the banner.
  useEffect(() => {
    if (!accountId) return;
    const key = pomodoroKey(accountId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || prefs === undefined) return;
    if (!config) {
      // Turning the Pomodoro off drops the cycle, so turning it on later starts fresh. The switch-off
      // shows before the server confirms it, and a failed save rolls it back, so the cycle stays
      // stored until no save is pending.
      if (!prefsSaving) store(IDLE_STATE);
      return;
    }
    // Pause and Resume change the running entry in steps; wait until the bar shows the result.
    if (!timer || busy.current) return;
    const result = advance(sync(), timer, Date.now(), config);
    store(result.state);
    if (result.rang) {
      ring();
      // The banner names the last phase that ended, and so does the notification.
      if (result.state.banner) notifyPhaseEnd(result.state.banner);
    }
    if (result.workEnded && config.stopAtEnd) onWorkEnded();
  });

  // Wake at the next deadline, so the bell does not wait for the next tick.
  useEffect(() => {
    if (!config) return;
    const deadline = nextDeadline(state, config.settings);
    if (deadline === null) return;
    const id = setTimeout(() => setWake((n) => n + 1), Math.min(MAX_DELAY_MS, Math.max(0, deadline - Date.now())));
    return () => clearTimeout(id);
  }, [state, config]);

  return {
    countdown: (now) => (config ? countdown(state, now, config.settings) : null),
    banner: config ? state.banner : null,
    dismiss: () => store({ ...stateRef.current, banner: null }),
  };
}
