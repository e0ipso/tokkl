import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from './account.ts';
import { keys } from './keys.ts';
import { acceptTimerState, useTimerState } from './timerHooks.ts';
import { connectTimerStream } from './timerStream.ts';
import { TimerStreamingContext } from './timerStreaming.ts';

const EVENTS_PATH = '/api/app/timer/events';

/**
 * Keeps the timer state current for the signed-in account. It opens the event stream, writes each
 * state into the caches, and tells the hooks whether the stream is up so they poll only when it is
 * not. It remounts per account, so switching accounts reopens the stream, and signing out closes it.
 */
export function TimerStateProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  return me ? <AccountTimerState key={me.id}>{children}</AccountTimerState> : children;
}

function AccountTimerState({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const wasDown = useRef(false);

  useEffect(
    () =>
      connectTimerStream(() => new EventSource(EVENTS_PATH), {
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
      }),
    [qc],
  );

  return (
    <TimerStreamingContext.Provider value={streaming}>
      <TimerStateReader />
      {children}
    </TimerStreamingContext.Provider>
  );
}

/**
 * Keeps the timer state query mounted so the state loads and the poll fallback runs whichever views
 * are on screen. It sits below the provider because the query reads whether the stream is up.
 */
function TimerStateReader() {
  useTimerState();
  return null;
}
