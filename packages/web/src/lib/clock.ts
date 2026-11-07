import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Ticking clocks for the views. Keep a ticking hook in the smallest component that shows the time,
 * so a tick re-renders that component and not the page around it.
 */

/** Re-renders every `intervalMs` and returns the current time. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Checks `select(Date.now())` every `intervalMs` and re-renders only when its result changes, such
 * as the minute of the day or whether a deadline has passed. `select` must return a primitive, and
 * the caller should keep it stable (useCallback) so the subscription is not renewed every render.
 */
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
