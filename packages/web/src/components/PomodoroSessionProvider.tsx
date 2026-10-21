import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { plannedEnd, transitionKind, type PomodoroSessionConfig, type SessionPhase, type TransitionKind } from '@tokkl/common/pomodoroSession';
import { useCreateEntry, useMe } from '../api/hooks.ts';
import { useNow } from '../lib/settings.ts';
import { createPomodoroSessionController } from './pomodoroSessionController.ts';
import { registerPomodoroSession } from './pomodoroSessionLifecycle.ts';
import { withPomodoroSessionLock } from './pomodoroSessionLock.ts';
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
  start: (config: PomodoroSessionConfig, fields: EntryDraft) => Promise<void>;
  nextPhase: () => Promise<void>;
  end: () => Promise<void>;
  updateFields: (changes: Partial<EntryDraft>) => Promise<void>;
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
  const toast = useToast();
  const now = useNow();
  const [, refresh] = useState(0);
  const [pending, setPending] = useState(0);
  const latest = useRef({ me, createEntry, toast });
  latest.current = { me, createEntry, toast };
  const mounted = useRef(false);
  const signingOut = useRef(false);
  const { storage, controller } = useMemo(() => {
    const storage = createPomodoroSessionStorage(accountId, () => window.localStorage);
    const controller = createPomodoroSessionController({
      read: storage.read,
      write: (session, claim) => {
        storage.write(session, claim);
        if (mounted.current) refresh((value) => value + 1);
      },
      lock: (run) => withPomodoroSessionLock(accountId, run),
      now: () => new Date(),
      id: () => crypto.randomUUID(),
      grid: () => {
        const account = latest.current.me;
        if (!account || account.id !== accountId) throw new Error('The Pomodoro account is no longer signed in.');
        return { minutes: account.time_resolution_minutes, timeZone: account.timezone };
      },
      createEntry: (entry) => latest.current.createEntry.mutateAsync(entry),
      message: (message) => latest.current.toast.show(message),
    });
    return { storage, controller };
  }, [accountId]);

  useLayoutEffect(() => {
    mounted.current = true;
    controller.activate();
    const forget = () => { controller.close(); storage.forget(); };
    const unregister = registerPomodoroSession({
      finish: async () => {
        signingOut.current = true;
        try { await controller.end(); } catch (error) { latest.current.toast.error(error); }
        finally { controller.close(); }
      },
      forget,
    });
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === pomodoroSessionKey(accountId)) refresh((value) => value + 1);
    };
    window.addEventListener('storage', sync);
    return () => {
      mounted.current = false;
      controller.close();
      unregister();
      window.removeEventListener('storage', sync);
    };
  }, [accountId, controller, storage]);

  const run = async (operation: () => Promise<void>) => {
    if (signingOut.current) return;
    setPending((count) => count + 1);
    try { await operation(); } catch (error) { toast.error(error); }
    finally { if (mounted.current) setPending((count) => count - 1); }
  };
  const session = storage.read();
  const phase = session && !session.ending ? session.phase : null;
  return (
    <Context.Provider value={{
      session, phase, now, busy: pending > 0,
      plannedEnd: phase && session ? plannedEnd(phase, session.config) : null,
      transitionKind: phase && session ? transitionKind(phase, session.config) : null,
      start: (config, fields) => run(() => controller.start(config, fields)),
      nextPhase: () => run(() => controller.nextPhase(session)),
      end: () => run(() => controller.end()),
      updateFields: (changes) => run(() => controller.updateFields(changes)),
    }}>
      {children}
    </Context.Provider>
  );
}
