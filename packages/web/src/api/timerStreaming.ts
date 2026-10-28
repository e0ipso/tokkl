import { createContext, useContext } from 'react';

/** True while the timer event stream is connected. The provider sets it; without one the stream counts as down. */
export const TimerStreamingContext = createContext(false);

export function useTimerStreaming(): boolean {
  return useContext(TimerStreamingContext);
}
