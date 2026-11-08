import { useCallback, useEffect, useRef } from 'react';

/**
 * A signal that aborts when the component unmounts, such as when the user navigates to another
 * page, for work that should stop with the view: a download the user would no longer see finish.
 * Call the returned function when the work starts.
 */
export function useUnmountSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return useCallback(() => (controller.current ??= new AbortController()).signal, []);
}

/**
 * Runs `work` with `signal` and hands a failure to `report`, unless `signal` aborted: a cancel by
 * the view going away is not an error to show.
 */
export async function reportUnlessCancelled(
  signal: AbortSignal,
  work: (signal: AbortSignal) => Promise<unknown>,
  report: (error: unknown) => void,
): Promise<void> {
  try {
    await work(signal);
  } catch (error) {
    if (!signal.aborted) report(error);
  }
}
