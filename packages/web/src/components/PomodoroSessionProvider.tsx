import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { plannedEnd, transitionKind, type PomodoroSessionConfig, type SessionPhase, type TransitionKind } from '@tokkl/common/pomodoroSession';
import { useCreateEntry, useCurrentEntry, useMe, useRestoreEntry, useStopEntry } from '../api/hooks.ts';
import { api } from '../api/client.ts';
import type { TimeEntry } from '../api/types.ts';
import { useNow } from '../lib/settings.ts';
import { hasSavedPomodoro, watchPomodoroRetries } from './pomodoroSessionRetry.ts';
import { createPomodoroSessionController } from './pomodoroSessionController.ts';
import { registerPomodoroSession } from './pomodoroSessionLifecycle.ts';
import { createPomodoroSessionAlarm, type SessionAlarm } from './pomodoroSessionAlarm.ts';
import { notifySessionPhaseEnd } from './phaseNotification.ts';
import { SESSION_PHASE_LABEL } from './pomodoroSessionPresentation.ts';
import { withPomodoroSessionLock, withTimerOperationLock } from './pomodoroSessionLock.ts';
import { isPaused } from './pauseChain.ts';
import { readTabChain, writeTabChain } from './tabChain.ts';
import { createPomodoroSessionStorage, pomodoroSessionKey, type PomodoroSessionState } from './pomodoroSessionState.ts';
import { useToast } from './Toast.tsx';
import type { EntryDraft } from './useEntryFields.ts';

interface PomodoroSession {
  session: PomodoroSessionState | null;
  phase: SessionPhase | null;
  plannedEnd: Date | null;
  transitionKind: TransitionKind | null;
  now: Date;
  busy: boolean;
  unsavedCount: number;
  ringing: boolean;
  audioBlocked: boolean;
  unlockAudio: () => void;
  retryAudio: () => void;
  start: (config: PomodoroSessionConfig, fields: EntryDraft) => Promise<void>;
  nextPhase: () => Promise<void>;
  end: () => Promise<void>;
  updateFields: (changes: Partial<EntryDraft>) => Promise<void>;
  startTimer: (at: Date, create: () => Promise<TimeEntry | null>, resuming?: boolean) => Promise<TimeEntry | null>;
  pauseTimer: (operation: () => Promise<void>) => Promise<void>;
}

const Context = createContext<PomodoroSession | null>(null);

export function usePomodoroSession(): PomodoroSession {
  const session = useContext(Context);
  if (!session) throw new Error('usePomodoroSession must be used inside PomodoroSessionProvider');
  return session;
}

export function PomodoroSessionProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  // Remount the account's memory and operations together if authentication switches in place.
  return me ? <AccountSession key={me.id} accountId={me.id}>{children}</AccountSession> : children;
}

function AccountSession({ accountId, children }: { accountId: number; children: ReactNode }) {
  const { data: me } = useMe();
  const createEntry = useCreateEntry();
  const stopEntry = useStopEntry();
  const restoreEntry = useRestoreEntry();
  const { data: current, dataUpdatedAt: currentFetchedAt } = useCurrentEntry();
  const toast = useToast();
  const now = useNow();
  const [, refresh] = useState(0);
  const [pending, setPending] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const latest = useRef({ me, createEntry, stopEntry, restoreEntry, toast });
  latest.current = { me, createEntry, stopEntry, restoreEntry, toast };
  const mounted = useRef(false);
  const signingOut = useRef(false);
  const retries = useRef<ReturnType<typeof watchPomodoroRetries> | null>(null);
  const { storage, controller, alarm, currentAlarm } = useMemo(() => {
    const storage = createPomodoroSessionStorage(accountId, () => window.localStorage);
    const currentAlarm = (): SessionAlarm | null => {
      const state = storage.read();
      if (!state || state.ending || Date.now() < plannedEnd(state.phase, state.config).getTime()) return null;
      return { key: `${state.id}:${state.revision}`, transition: transitionKind(state.phase, state.config) };
    };
    const alarm = createPomodoroSessionAlarm(accountId, { current: currentAlarm, onError: setAudioBlocked });
    const controller = createPomodoroSessionController({
      read: storage.read,
      readUnsaved: storage.readUnsaved,
      write: (session, claim, unsaved) => {
        storage.write(session, claim, unsaved);
        retries.current?.schedule();
        alarm.update(currentAlarm());
        if (mounted.current) refresh((value) => value + 1);
      },
      lock: (run) => withPomodoroSessionLock(accountId, run),
      timerLock: (run) => withTimerOperationLock(accountId, storage.read() !== null, run),
      beforeStart: async (at) => {
        // Read under the lock, after an in-flight pause or local start has settled.
        const running = await api.get<TimeEntry | null>('/api/v9/me/time_entries/current?meta=true');
        if (running) {
          const stopped = await latest.current.stopEntry.mutateAsync({ id: running.id, stop: at.toISOString() });
          if (stopped.server_deleted_at) {
            latest.current.toast.show('Too short to keep, so the entry went to the trash', {
              action: { label: 'Undo', run: () => latest.current.restoreEntry.mutate(stopped.id) },
            });
          }
        }
        writeTabChain(accountId, null);
      },
      now: () => new Date(),
      id: () => crypto.randomUUID(),
      grid: () => {
        const account = latest.current.me;
        if (!account || account.id !== accountId) throw new Error('The Pomodoro account is no longer signed in.');
        return { minutes: account.time_resolution_minutes, timeZone: account.timezone };
      },
      createEntry: (entry) => latest.current.createEntry.mutateAsync(entry),
      hasSavedEntry: hasSavedPomodoro,
      message: (message) => latest.current.toast.show(message),
    });
    return { storage, controller, alarm, currentAlarm };
  }, [accountId]);

  useLayoutEffect(() => {
    mounted.current = true;
    signingOut.current = false;
    controller.activate();
    alarm.activate();
    if (storage.read()) writeTabChain(accountId, null);
    const startRetries = () => {
      retries.current?.stop();
      if (signingOut.current) return;
      retries.current = watchPomodoroRetries(
        storage.readUnsaved, (force) => controller.retry(force), (error) => latest.current.toast.error(error),
      );
      // A crash can leave an End claim after its queue item was already acknowledged.
      if (storage.read()?.ending) void controller.retry().catch((error) => latest.current.toast.error(error));
    };
    startRetries();
    const forget = () => { retries.current?.stop(); alarm.dispose(); controller.close(); storage.forget(); };
    const unregister = registerPomodoroSession({
      finish: async () => {
        signingOut.current = true;
        retries.current?.stop();
        try { await controller.end(true); } catch (error) { latest.current.toast.error(error); }
        finally { controller.close(); }
      },
      forget,
    });
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === pomodoroSessionKey(accountId)) {
        // Also clear a chain held only in this tab after a refused storage write.
        if (storage.read()) writeTabChain(accountId, null);
        alarm.update(currentAlarm());
        retries.current?.schedule();
        refresh((value) => value + 1);
      }
    };
    const hide = () => { retries.current?.stop(); alarm.dispose(); };
    const show = () => { alarm.activate(); alarm.update(currentAlarm()); startRetries(); };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    window.addEventListener('storage', sync);
    return () => {
      mounted.current = false;
      retries.current?.stop();
      alarm.dispose();
      controller.close();
      unregister();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('storage', sync);
    };
  }, [accountId, controller, storage, alarm, currentAlarm]);

  const run = async (operation: () => Promise<void>) => {
    if (signingOut.current) return;
    setPending((count) => count + 1);
    try { await operation(); } catch (error) { toast.error(error); }
    finally { if (mounted.current) setPending((count) => count - 1); }
  };
  const session = storage.read();
  useEffect(() => {
    if (!session || !current) return;
    void controller.observeTimer(current).catch((error) => latest.current.toast.error(error));
  }, [controller, current, currentFetchedAt, session?.id, session?.pomodoroStart]);
  const phase = session && !session.ending ? session.phase : null;
  const ringing = phase !== null && currentAlarm() !== null;
  const ringKey = ringing && session ? `${session.id}:${session.revision}` : null;
  useLayoutEffect(() => { alarm.update(currentAlarm()); }, [alarm, currentAlarm, ringKey]);
  useEffect(() => {
    if (!ringKey || !session || !phase) return;
    const notification = notifySessionPhaseEnd(session.id, SESSION_PHASE_LABEL[phase.kind]);
    return () => notification?.close();
  }, [ringKey]);
  return (
    <Context.Provider value={{
      session, phase, now, busy: pending > 0, ringing, audioBlocked, unsavedCount: storage.readUnsaved().length,
      unlockAudio: () => alarm.unlock(),
      retryAudio: () => { alarm.unlock(); alarm.retry(); },
      plannedEnd: phase && session ? plannedEnd(phase, session.config) : null,
      transitionKind: phase && session ? transitionKind(phase, session.config) : null,
      start: (config, fields) => run(() => controller.start(config, fields)),
      nextPhase: () => run(() => controller.nextPhase(session)),
      end: () => run(() => controller.end()),
      updateFields: (changes) => run(() => controller.updateFields(changes)),
      startTimer: (at, create, resuming = false) => controller.startTimer(at, create,
        () => !signingOut.current && (!resuming || isPaused(readTabChain(accountId)))),
      pauseTimer: (operation) => controller.pauseTimer(operation),
    }}>
      {children}
    </Context.Provider>
  );
}
