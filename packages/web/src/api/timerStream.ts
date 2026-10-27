import { isTimerState } from './timerState.ts';
import type { TimerState } from './types.ts';

/** The part of `EventSource` the stream uses, so it can be driven without a browser. */
export interface TimerEventSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface TimerStreamHandlers {
  /** A `timer` event with a well-formed state. */
  onState(state: TimerState): void;
  /** The stream went up (true) or down (false). Called only when that changes. */
  onStatus(up: boolean): void;
}

const CLOSED = 2;
const DEFAULT_RETRY_MS = 5000;

/**
 * Holds the timer event stream open. The browser reconnects by itself after a dropped connection,
 * but gives up (readyState CLOSED) when the server replies with an error status, such as a proxy
 * restarting. Then the source is closed and a new one opens after `retryMs`. The returned function
 * stops it for good.
 */
export function connectTimerStream(
  open: () => TimerEventSource,
  handlers: TimerStreamHandlers,
  retryMs: number = DEFAULT_RETRY_MS,
): () => void {
  let source: TimerEventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let up = false;
  let stopped = false;

  const setUp = (next: boolean) => {
    if (stopped || up === next) return;
    up = next;
    handlers.onStatus(next);
  };

  const connect = () => {
    retry = null;
    const current = open();
    source = current;
    current.addEventListener('open', () => setUp(true));
    current.addEventListener('error', () => {
      setUp(false);
      if (!stopped && current.readyState === CLOSED) {
        current.close();
        retry = setTimeout(connect, retryMs);
      }
    });
    current.addEventListener('timer', (event) => {
      if (stopped) return;
      let data: unknown;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isTimerState(data)) handlers.onState(data);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
    source?.close();
  };
}
