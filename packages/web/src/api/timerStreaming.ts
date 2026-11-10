import { createContext, useContext } from 'react';

/** Without a provider the stream counts as down. */
export const TimerStreamingContext = createContext(false);

export function useTimerStreaming(): boolean {
  return useContext(TimerStreamingContext);
}
