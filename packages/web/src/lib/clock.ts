import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Keep a ticking hook in the smallest component that shows the time, so a tick re-renders only that. */

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Re-renders only when `select` changes. It must return a primitive and be stable (useCallback). */
export function useClockSelector<T extends string | number | boolean | null>(
  intervalMs: number,
  select: (nowMs: number) => T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  return useSyncExternalStore(subscribe, () => select(Date.now()));
}
