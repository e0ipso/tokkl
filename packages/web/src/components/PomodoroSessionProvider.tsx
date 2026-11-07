import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import { useMe } from '../api/account.ts';
import { keys } from '../api/keys.ts';
import { getClockOffset } from '../api/serverClock.ts';
import { useEndPomodoro, useNextPhase, useStartPomodoro, useTimerState } from '../api/timerHooks.ts';
import type { PomodoroTransition, TimerPomodoro, TimerPomodoroPhase, TimerState } from '../api/types.ts';
import { useClockSelector } from '../lib/clock.ts';
import { createPomodoroSessionAlarm, phaseAlarm } from './pomodoroSessionAlarm.ts';
import { notifySessionPhaseEnd } from './phaseNotification.ts';
import { createDiscardNotices, phaseLabel } from './pomodoroSessionPresentation.ts';
import { useToast } from './Toast.tsx';
import type { EntryDraft } from './useEntryFields.ts';
import { t } from '../i18n/messages.ts';

/**
 * The server's session as the views read it. It changes only when the state or the ringing does,
 * not every second: views that show a countdown tick on their own with `useServerNow`.
 */
interface PomodoroSession {
  /** The server's session, or null when none runs. */
  session: TimerPomodoro | null;
  phase: TimerPomodoroPhase | null;
  plannedEnd: Date | null;
  transitionKind: PomodoroTransition | null;
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
  return me ? (
    <AccountSession key={me.id} accountId={me.id}>
      {children}
    </AccountSession>
  ) : (
    children
  );
}

/** What should ring now, read from the cache rather than a render's copy, so a state that just arrived counts at once. */
function cachedAlarm(qc: QueryClient) {
  return phaseAlarm(qc.getQueryData<TimerState>(keys.timer)?.pomodoro, Date.now() + getClockOffset());
}

/**
 * Owns the phase-end alarm for as long as the account is signed in here. A page kept in the
 * back-forward cache must not keep the audio lock while hidden.
 */
function useSessionAlarm(accountId: number, onError: (blocked: boolean) => void) {
  const qc = useQueryClient();
  const alarm = useRef<ReturnType<typeof createPomodoroSessionAlarm> | null>(null);
  const reportError = useEffectEvent(onError);
  useLayoutEffect(() => {
    const created = createPomodoroSessionAlarm(accountId, {
      current: () => cachedAlarm(qc),
      onError: blocked => reportError(blocked),
    });
    alarm.current = created;
    created.activate();
    const hide = () => created.dispose();
    const show = () => {
      created.activate();
      created.update(cachedAlarm(qc));
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      created.dispose();
      alarm.current = null;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [accountId, qc]);
  return alarm;
}

/**
 * A view of the server's session plus what only this tab can do: ring, notify and say a pomodoro
 * was too short. The server applies every session rule; the actions only post to it.
 */
function AccountSession({ accountId, children }: { accountId: number; children: ReactNode }) {
  const { data: state } = useTimerState();
  const toast = useToast();
  const startPomodoro = useStartPomodoro();
  const confirmNext = useNextPhase();
  const endPomodoro = useEndPomodoro();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const alarmRef = useSessionAlarm(accountId, setAudioBlocked);
  // Set synchronously, so a second click in the same frame sees it before the mutation reports pending.
  const acting = useRef(false);

  const session = state?.pomodoro ?? null;
  // Checked every second on the server's clock, but the provider re-renders only when the phase's
  // planned end is crossed or the phase changes.
  const ringKey = useClockSelector(
    1000,
    useCallback(now => phaseAlarm(session, now + getClockOffset())?.key ?? null, [session]),
  );
  const transition = ringKey === null ? null : (session?.transition ?? null);
  // Runs on every new state and when the planned end is crossed.
  useLayoutEffect(() => {
    alarmRef.current?.update(ringKey === null || transition === null ? null : { key: ringKey, transition });
  }, [alarmRef, ringKey, transition]);

  const endedPhase = session ? phaseLabel(session.phase.kind) : null;
  const notify = useEffectEvent((key: string) => (endedPhase ? notifySessionPhaseEnd(key, endedPhase) : null));
  useEffect(() => {
    if (!ringKey) return;
    const notification = notify(ringKey);
    return () => notification?.close();
  }, [ringKey]);

  const discards = useRef(createDiscardNotices());
  const announceDiscard = useEffectEvent((next: TimerState) => {
    if (discards.current(next)) toast.show(t('pomodoro.tooShort'));
  });
  useEffect(() => {
    if (state) announceDiscard(state);
  }, [state]);

  const busy = startPomodoro.isPending || confirmNext.isPending || endPomodoro.isPending;
  const { mutateAsync: startSession } = startPomodoro;
  const { mutateAsync: confirmNextPhase } = confirmNext;
  const { mutateAsync: endSession } = endPomodoro;
  const value = useMemo<PomodoroSession>(() => {
    const run = async (operation: () => Promise<unknown>) => {
      if (acting.current) return;
      acting.current = true;
      try {
        await operation();
      } catch (error) {
        toast.error(error);
      } finally {
        acting.current = false;
      }
    };
    return {
      session,
      phase: session?.phase ?? null,
      plannedEnd: session ? new Date(session.phase.planned_end) : null,
      transitionKind: session?.transition ?? null,
      busy,
      ringing: ringKey !== null,
      audioBlocked,
      unlockAudio: () => alarmRef.current?.unlock(),
      retryAudio: () => {
        alarmRef.current?.unlock();
        alarmRef.current?.retry();
      },
      start: (config, fields) =>
        run(() =>
          startSession({
            description: fields.description,
            project_id: fields.project_id,
            task_id: fields.task_id,
            tags: [...fields.tags],
            billable: fields.billable,
            work_minutes: config.workMinutes,
            short_rest_minutes: config.shortRestMinutes,
            long_rest_minutes: config.longRestMinutes,
            long_rest_every: config.longRestEvery,
          }),
        ),
      nextPhase: () => run(() => confirmNextPhase()),
      end: () => run(() => endSession()),
    };
  }, [session, busy, ringKey, audioBlocked, alarmRef, toast, startSession, confirmNextPhase, endSession]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
