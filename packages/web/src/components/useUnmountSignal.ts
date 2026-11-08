import { useCallback, useEffect, useMemo, useRef } from 'react';

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

/** One run of work the user can cancel: its signal, and the cancel that aborts it. */
export interface Cancellable {
  readonly signal: AbortSignal;
  cancel(): void;
}

/** Starts a run that aborts on its own `cancel` or when `parent` aborts, such as the view going away. */
export function startCancellable(parent: AbortSignal): Cancellable {
  const controller = new AbortController();
  return { signal: AbortSignal.any([parent, controller.signal]), cancel: () => controller.abort() };
}

/**
 * Work the user can cancel, such as a download: `start` returns the signal of a new run, which
 * aborts when `cancel` is called or the component unmounts (`useUnmountSignal`). `cancel` aborts
 * the latest run. The Cancel control goes away once `running` turns false, so after a cancel focus
 * returns to `origin`, the control that started the run.
 */
export function useCancellable(running: boolean): {
  start: (origin: HTMLElement) => AbortSignal;
  cancel: () => void;
} {
  const unmountSignal = useUnmountSignal();
  const current = useRef<Cancellable | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (running || !refocus.current) return;
    refocus.current = false;
    origin.current?.focus();
  }, [running]);
  return useMemo(
    () => ({
      start: from => {
        origin.current = from;
        current.current = startCancellable(unmountSignal());
        return current.current.signal;
      },
      cancel: () => {
        refocus.current = true;
        current.current?.cancel();
      },
    }),
    [unmountSignal],
  );
}

/**
 * Runs `work` with `signal` and hands a failure to `report`, unless `signal` aborted: a cancel by
 * the user or by the view going away is not an error to show.
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
