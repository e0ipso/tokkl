import { useCallback, useEffect, useMemo, useRef } from 'react';

/** For work that should stop with the view. Call the returned function when the work starts. */
export function useUnmountSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return useCallback(() => (controller.current ??= new AbortController()).signal, []);
}

export interface Cancellable {
  readonly signal: AbortSignal;
  cancel(): void;
}

/** Aborts on its own `cancel` or when `parent` aborts. */
export function startCancellable(parent: AbortSignal): Cancellable {
  const controller = new AbortController();
  return { signal: AbortSignal.any([parent, controller.signal]), cancel: () => controller.abort() };
}

/** `cancel` aborts the latest run; when `running` turns false after a cancel, focus returns to `origin`. */
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

/** A cancel by the user or the view going away is not an error to show. */
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
