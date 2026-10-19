import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useCurrentEntry, useMe, usePreferences, useStopEntry } from '../api/hooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { useNow } from '../lib/settings.ts';
import { isPaused, pause as pauseChain, type PauseChain } from './pauseChain.ts';
import type { PhaseEnd, TimerView } from './pomodoroCycle.ts';
import { readTabChain, writeTabChain } from './tabChain.ts';
import { useToast } from './Toast.tsx';
import { usePomodoro, type Pomodoro } from './usePomodoro.ts';

export interface PendingPause {
  stopAfter: boolean;
}

interface TimerCoordination {
  /** Set while a pause or resume is in flight, from the timer bar or the Pomodoro. */
  busy: RefObject<boolean>;
  /** The timer bar's Pause while the bar is mounted. It also saves a description still being edited. */
  barPause: RefObject<(() => Promise<void>) | null>;
  /**
   * Set while a pause is stopping the entry. Stop pressed meanwhile sets `stopAfter` instead of
   * sending its own stop, and the pause then ends the chain rather than recording the pause.
   */
  pausing: RefObject<PendingPause | null>;
  pomodoro: Pomodoro;
}

/** The running entry, whether Resume started it, and whether a pause chain waits for Resume. */
function timerView(current: TimeEntry | null, chain: PauseChain | null): TimerView {
  return { entryId: current?.id ?? null, resumed: current !== null && chain?.runningId === current.id, paused: isPaused(chain) };
}

const OFF: Pomodoro = { countdown: () => null, banner: null, dismiss: () => undefined };

const Coordination = createContext<TimerCoordination>({
  busy: { current: false }, barPause: { current: null }, pausing: { current: null }, pomodoro: OFF,
});

/** What the timer bar shares with the Pomodoro that runs on every page. */
export function useTimerCoordination(): TimerCoordination {
  return useContext(Coordination);
}

/**
 * Runs the Pomodoro on every signed-in page, so phases end, ring and show their banner at the
 * deadline wherever the user is. The timer bar shows the countdown when it is mounted.
 *
 * With stop-at-end on, the end of a work phase pauses the running entry. While the timer bar is
 * mounted, its own Pause does it. Elsewhere this provider stops the entry and records the pause in
 * the chain the same way, so Resume on the timer page starts a clone. Either way the pause waits
 * until no other write is in flight, and holds `busy` while it runs.
 */
export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const accountId = me?.id ?? 0;
  const { data: prefs } = usePreferences();
  const { data: current } = useCurrentEntry();
  const stopEntry = useStopEntry();
  const writes = useIsMutating();
  const toast = useToast();
  // Moves the cycle on every second; deadlines also wake it between ticks.
  useNow(1000);
  const busy = useRef(false);
  const barPause = useRef<(() => Promise<void>) | null>(null);
  const pausing = useRef<PendingPause | null>(null);
  // The running entry whose work phase ended, until it is paused.
  const pauseFor = useRef<number | null>(null);

  const pomodoro = usePomodoro({
    accountId,
    prefs,
    timer: current === undefined ? null : timerView(current, readTabChain(accountId)),
    busy,
    onWorkEnded: () => {
      pauseFor.current = current?.id ?? null;
    },
  });

  const pauseHere = async (entry: TimeEntry) => {
    busy.current = true;
    const pending: PendingPause = { stopAfter: false };
    pausing.current = pending;
    try {
      const stopped = await stopEntry.mutateAsync(entry.id);
      writeTabChain(accountId, pending.stopAfter ? null : pauseChain(readTabChain(accountId), stopped, Date.now()));
    } catch (error) {
      toast.error(error);
    } finally {
      pausing.current = null;
      busy.current = false;
    }
  };

  useEffect(() => {
    if (pauseFor.current === null || busy.current || writes > 0) return;
    const id = pauseFor.current;
    pauseFor.current = null;
    // Stopped, paused or replaced in the meantime: there is nothing left to pause.
    if (current?.id !== id) return;
    if (barPause.current) void barPause.current();
    else void pauseHere(current);
  });

  return <Coordination.Provider value={{ busy, barPause, pausing, pomodoro }}>{children}</Coordination.Provider>;
}

const PHASE_ENDED: Record<PhaseEnd, string> = {
  work: 'Work phase over. Time for a break.',
  short: 'Short break over. Back to work.',
  long: 'Long break over. Back to work.',
};

/** The banner for the last phase end, shown until it is dismissed. */
export function PomodoroBanner() {
  const { pomodoro } = useTimerCoordination();
  if (!pomodoro.banner) return null;
  return (
    <div className="pomodoro-banner" role="status">
      <span>{PHASE_ENDED[pomodoro.banner]}</span>
      <button type="button" className="button button-ghost" onClick={pomodoro.dismiss}>Dismiss</button>
    </div>
  );
}
