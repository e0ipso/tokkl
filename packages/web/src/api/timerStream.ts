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
  /**
   * The stream became trustworthy (true) or stopped being so (false). Called only when that changes.
   * See `connectTimerStream` for what counts.
   */
  onStatus(up: boolean): void;
}

const CLOSED = 2;
const DEFAULT_RETRY_MS = 5000;
/** The server sends a `keep-alive` event every 25 s, so a minute without one means it is not getting through. */
const DEFAULT_SILENCE_MS = 60_000;

/** The state a `timer` event carries, or null when its data is not JSON or not a whole state. */
function decodeState(data: unknown): TimerState | null {
  let value: unknown;
  try {
    value = JSON.parse(String(data));
  } catch {
    return null;
  }
  return isTimerState(value) ? value : null;
}

/**
 * Holds the timer event stream open and says whether its states can be trusted, so the hooks poll
 * only when they cannot.
 *
 * A connection counts as up from the first well-formed state it delivers; the server sends one as
 * soon as the stream opens, so opening alone switches nothing off. It counts as down again when:
 * - it errs. The browser reconnects by itself after a dropped connection, and the next state brings
 *   it back up. When the browser gives up instead (readyState CLOSED), such as on an error status
 *   from a restarting proxy, the source is closed and a new one opens after `retryMs`.
 * - a `timer` event does not decode. A stream that sends states this app cannot read is no better
 *   than none: the source is closed and a new one opens after `retryMs`, as when the browser gives up.
 * - it stays silent for `silenceMs`: no state within that time of opening, or no state or
 *   keep-alive within that time of the last one, such as when a buffering proxy holds the body back.
 *   The source is replaced at once. Keep-alives restart that wait only once a state has arrived, so
 *   a connection that only ever sends keep-alives does not pass for a working one.
 *
 * The returned function stops it for good.
 */
export function connectTimerStream(
  open: () => TimerEventSource,
  handlers: TimerStreamHandlers,
  retryMs: number = DEFAULT_RETRY_MS,
  silenceMs: number = DEFAULT_SILENCE_MS,
): () => void {
  let source: TimerEventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let silence: ReturnType<typeof setTimeout> | null = null;
  let up = false;
  let stopped = false;

  const quiet = () => {
    if (silence !== null) clearTimeout(silence);
    silence = null;
  };

  const setUp = (next: boolean) => {
    if (stopped || up === next) return;
    up = next;
    handlers.onStatus(next);
  };

  const connect = () => {
    retry = null;
    const current = open();
    source = current;
    // Whether this connection has delivered a well-formed state since it last opened.
    let delivered = false;

    // Restarts the wait for the next event on the open source.
    const watch = () => {
      quiet();
      if (stopped) return;
      silence = setTimeout(() => {
        silence = null;
        setUp(false);
        current.close();
        connect();
      }, silenceMs);
    };
    const down = () => {
      delivered = false;
      quiet();
      setUp(false);
    };
    const reopenLater = () => {
      current.close();
      if (!stopped) retry = setTimeout(connect, retryMs);
    };

    current.addEventListener('open', () => {
      delivered = false;
      watch();
    });
    current.addEventListener('keep-alive', () => {
      if (delivered) watch();
    });
    current.addEventListener('error', () => {
      down();
      if (!stopped && current.readyState === CLOSED) reopenLater();
    });
    current.addEventListener('timer', event => {
      if (stopped) return;
      const state = decodeState(event.data);
      if (!state) {
        down();
        reopenLater();
        return;
      }
      delivered = true;
      watch();
      handlers.onState(state);
      setUp(true);
    });
  };

  connect();
  return () => {
    stopped = true;
    quiet();
    if (retry !== null) clearTimeout(retry);
    source?.close();
  };
}
