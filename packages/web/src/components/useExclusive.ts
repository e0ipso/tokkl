import { useCallback, useRef, useState } from 'react';

export interface Exclusive {
  busy: boolean;
  /** A call while one runs does nothing. */
  run: (action: () => Promise<unknown>) => Promise<void>;
}

/** The guard is a ref set before the first await, so a same-frame second click is refused before `busy` renders. */
export function useExclusive(): Exclusive {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
