import { createContext, useContext, useState, type ReactNode, type RefObject } from 'react';

export interface PendingPause {
  stopAfter: boolean;
}

interface PauseCoordination {
  /** Set while a pause or resume is in flight, from the timer bar or anything else that pauses the entry. */
  busy: RefObject<boolean>;
  /**
   * Set while a pause is stopping the entry. Stop pressed meanwhile sets `stopAfter` instead of
   * sending its own stop, and the pause then ends the chain rather than recording the pause.
   */
  pausing: RefObject<PendingPause | null>;
}

const Coordination = createContext<PauseCoordination>({ busy: { current: false }, pausing: { current: null } });

/** The pause and resume in flight, shared by the timer bar and every other writer of the pause chain. */
export function usePauseCoordination(): PauseCoordination {
  return useContext(Coordination);
}

/** Holds the pause coordination for the signed-in shell, above every component that pauses the entry. */
export function PauseCoordinationProvider({ children }: { children: ReactNode }) {
  const [value] = useState<PauseCoordination>(() => ({ busy: { current: false }, pausing: { current: null } }));
  return <Coordination.Provider value={value}>{children}</Coordination.Provider>;
}
