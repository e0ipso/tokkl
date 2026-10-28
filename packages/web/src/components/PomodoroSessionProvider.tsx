import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import { keys, useMe } from '../api/hooks.ts';
import { getClockOffset } from '../api/serverClock.ts';
import { useEndPomodoro, useNextPhase, useServerNow, useStartPomodoro, useTimerState } from '../api/timerHooks.ts';
import type { PomodoroTransition, TimerPomodoro, TimerPomodoroPhase, TimerState } from '../api/types.ts';
import { createPomodoroSessionAlarm, phaseAlarm } from './pomodoroSessionAlarm.ts';
import { notifySessionPhaseEnd } from './phaseNotification.ts';
import { SESSION_PHASE_LABEL, createDiscardNotices } from './pomodoroSessionPresentation.ts';
import { useToast } from './Toast.tsx';
import type { EntryDraft } from './useEntryFields.ts';

interface PomodoroSession {
  /** The server's session, or null when none runs. */
  session: TimerPomodoro | null;
  phase: TimerPomodoroPhase | null;
  plannedEnd: Date | null;
  transitionKind: PomodoroTransition | null;
  /** The server-corrected time, ticking every second. */
  now: Date;
  busy: boolean;
  ringing: boolean;
  audioBlocked: boolean;
  unlockAudio: () => void;
  retryAudio: () => void;
  start: (config: PomodoroSessionConfig, fields: EntryDraft) => Promise<void>;
  nextPhase: () => Promise<void>;
  end: () => Promise<void>;
}

const Context = createContext<PomodoroSession | null>(null);

export function usePomodoroSession(): PomodoroSession {
  const session = useContext(Context);
  if (!session) throw new Error('usePomodoroSession must be used inside PomodoroSessionProvider');
  return session;
}

export function PomodoroSessionProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  // The alarm's audio lock and channel are per account, so they are rebuilt if authentication switches in place.
  return me ? <AccountSession key={me.id} accountId={me.id}>{children}</AccountSession> : children;
}

/**
 * A view of the server's session plus what only this tab can do: ring, notify and say a pomodoro
 * was too short. The server applies every session rule; the actions only post to it.
 */
function AccountSession({ accountId, children }: { accountId: number; children: ReactNode }) {
  const qc = useQueryClient();
  const { data: state } = useTimerState();
  const now = useServerNow(1000);
  const toast = useToast();
  const startPomodoro = useStartPomodoro();
  const confirmNext = useNextPhase();
  const endPomodoro = useEndPomodoro();
  const [audioBlocked, setAudioBlocked] = useState(false);
  // Set synchronously, so a second click in the same frame sees it before the mutation reports pending.
  const acting = useRef(false);

  const alarm = useMemo(() => createPomodoroSessionAlarm(accountId, {
    // Read the cache, not a render's copy, so a state that just arrived silences the alarm at once.
    current: () => phaseAlarm(qc.getQueryData<TimerState>(keys.timer)?.pomodoro, Date.now() + getClockOffset()),
    onError: setAudioBlocked,
  }), [accountId, qc]);

  useLayoutEffect(() => {
    alarm.activate();
    // A page kept in the back-forward cache must not keep the audio lock while hidden.
    const hide = () => alarm.dispose();
    const show = () => {
      alarm.activate();
      alarm.update(phaseAlarm(qc.getQueryData<TimerState>(keys.timer)?.pomodoro, Date.now() + getClockOffset()));
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      alarm.dispose();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [alarm, qc]);

  const session = state?.pomodoro ?? null;
  const target = phaseAlarm(session, now.getTime());
  const ringKey = target?.key ?? null;
  // Runs on every new state and on every tick that crosses the planned end.
  useLayoutEffect(() => { alarm.update(target); }, [alarm, ringKey, target?.transition]);
  useEffect(() => {
    if (!ringKey || !session) return;
    const notification = notifySessionPhaseEnd(ringKey, SESSION_PHASE_LABEL[session.phase.kind]);
    return () => notification?.close();
  }, [ringKey]);

  const discards = useRef(createDiscardNotices());
  useEffect(() => {
    if (state && discards.current(state)) toast.show('This pomodoro was too short to save.');
  }, [state]);

  const run = async (operation: () => Promise<unknown>) => {
    if (acting.current) return;
    acting.current = true;
    try { await operation(); } catch (error) { toast.error(error); }
    finally { acting.current = false; }
  };

  return (
    <Context.Provider value={{
      session, phase: session?.phase ?? null, now,
      plannedEnd: session ? new Date(session.phase.planned_end) : null,
      transitionKind: session?.transition ?? null,
      busy: startPomodoro.isPending || confirmNext.isPending || endPomodoro.isPending,
      ringing: target !== null, audioBlocked,
      unlockAudio: () => alarm.unlock(),
      retryAudio: () => { alarm.unlock(); alarm.retry(); },
      start: (config, fields) => run(() => startPomodoro.mutateAsync({
        description: fields.description, project_id: fields.project_id, task_id: fields.task_id,
        tags: [...fields.tags], billable: fields.billable,
        work_minutes: config.workMinutes, short_rest_minutes: config.shortRestMinutes,
        long_rest_minutes: config.longRestMinutes, long_rest_every: config.longRestEvery,
      })),
      nextPhase: () => run(() => confirmNext.mutateAsync()),
      end: () => run(() => endPomodoro.mutateAsync()),
    }}>
      {children}
    </Context.Provider>
  );
}
