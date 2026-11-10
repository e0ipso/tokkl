import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onSignOut } from '../lib/session.ts';
import { useMe } from './account.ts';
import { keys } from './keys.ts';
import { acceptTimerState, useTimerState } from './timerHooks.ts';
import { connectTimerStream } from './timerStream.ts';
import { TimerStreamingContext } from './timerStreaming.ts';

const EVENTS_PATH = '/api/app/timer/events';

/** Opens the event stream and tells the hooks whether to poll. Remounts per account; signing out closes it. */
export function TimerStateProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  return me ? <AccountTimerState key={me.id}>{children}</AccountTimerState> : children;
}

function AccountTimerState({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const wasDown = useRef(false);

  useEffect(() => {
    const stop = connectTimerStream(() => new EventSource(EVENTS_PATH), {
      onState: state => acceptTimerState(qc, state),
      onStatus: up => {
        setStreaming(up);
        if (!up) {
          wasDown.current = true;
          // A stream the server ended is followed by a read: a 403 there means signed out.
          void qc.refetchQueries({ queryKey: keys.timer });
        } else if (wasDown.current) {
          wasDown.current = false;
          void qc.refetchQueries({ queryKey: keys.timer });
        }
      },
    });
    // Logging out in this tab closes the stream before the server ends it, so no timer read follows.
    const unsubscribe = onSignOut(stop);
    return () => {
      unsubscribe();
      stop();
    };
  }, [qc]);

  return (
    <TimerStreamingContext.Provider value={streaming}>
      <TimerStateReader />
      {children}
    </TimerStreamingContext.Provider>
  );
}

/** Keeps the timer query mounted whatever views are on screen; below the provider since it reads stream status. */
function TimerStateReader() {
  useTimerState();
  return null;
}
