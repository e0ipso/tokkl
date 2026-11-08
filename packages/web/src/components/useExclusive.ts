import { useCallback, useRef, useState } from 'react';

export interface Exclusive {
  /** True while an action runs, for disabling the controls that would start another. */
  busy: boolean;
  /** Runs `action` unless one is already running, in which case the call does nothing. */
  run: (action: () => Promise<unknown>) => Promise<void>;
}

/**
 * Lets one of a group of actions run at a time, such as an editor's Save, Duplicate and Delete. The
 * guard is a ref set before the first await, so a second click or a key repeat in the same frame
 * is refused before React has rendered `busy`.
 */
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
