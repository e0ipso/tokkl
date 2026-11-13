import { useCallback, useEffect, useRef, useState } from 'react';

/** For work that should stop with the view. Call the returned function when the work starts. */
function useUnmountSignal(): () => AbortSignal {
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

/** Tracks a download, suppresses cancellation errors and returns focus to its button after Cancel. */
export function useDownload(report: (error: unknown) => void): {
  isPending: boolean;
  run: (origin: HTMLElement, work: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  cancel: () => void;
} {
  const [isPending, setPending] = useState(false);
  const unmountSignal = useUnmountSignal();
  const current = useRef<Cancellable | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (isPending || !refocus.current) return;
    refocus.current = false;
    origin.current?.focus();
  }, [isPending]);
  return {
    isPending,
    async run(from, work) {
      origin.current = from;
      const download = startCancellable(unmountSignal());
      current.current = download;
      setPending(true);
      await reportUnlessCancelled(download.signal, work, report);
      setPending(false);
    },
    cancel() {
      refocus.current = true;
      current.current?.cancel();
    },
  };
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
