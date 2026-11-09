import { isTimerState } from './timerState.ts';
import type { TimerState } from '@tokkl/types';

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
/** The server sends a `keep-alive` event every 25 s, so a minute without one means it is not getting through. */
const DEFAULT_SILENCE_MS = 60_000;

/** When to open a new source after the last one failed. */
export interface RetrySchedule {
  /**
   * The shortest wait, 5 s. It is also the `Retry-After` the server sends when its stream cap is
   * full. `EventSource` shows neither the status nor the headers of a refused connection, so the
   * schedule never goes below it instead of reading it.
   */
  baseMs: number;
  /** The longest wait, 60 s. */
  capMs: number;
  /** A number from 0 (included) to 1 (excluded), as `Math.random` returns. */
  random: () => number;
}

export const DEFAULT_RETRY: RetrySchedule = { baseMs: 5000, capMs: 60_000, random: Math.random };

/**
 * The wait before retry number `failures` (0 for the first) after failures in a row: a random time
 * between `baseMs` and a ceiling that doubles with each failure, from twice `baseMs` up to `capMs`.
 * The random part spreads the tabs a server restart dropped together, so they do not all come
 * back in the same second.
 */
export function retryDelay(failures: number, { baseMs, capMs, random }: RetrySchedule): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (failures + 1));
  return Math.round(baseMs + random() * (ceiling - baseMs));
}

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

export interface TimerStreamOptions {
  retry?: RetrySchedule;
  silenceMs?: number;
}

/**
 * Holds the timer event stream open and says whether its states can be trusted, so the hooks poll
 * only when they cannot.
 *
 * A connection counts as up from the first well-formed state it delivers; the server sends one as
 * soon as the stream opens, so opening alone switches nothing off. It counts as down again when:
 * - it errs. The browser reconnects by itself after a dropped connection, and the next state brings
 *   it back up. When the browser gives up instead (readyState CLOSED), such as on an error status
 *   from a restarting proxy or a full stream cap, the source is closed and a new one opens after
 *   `retryDelay`.
 * - a `timer` event does not decode. A stream that sends states this app cannot read is no better
 *   than none: the source is closed and a new one opens after `retryDelay`, as when the browser
 *   gives up.
 * - it stays silent for `silenceMs`: no state within that time of opening, or no state or
 *   keep-alive within that time of the last one, such as when a buffering proxy holds the body back.
 *   The source is closed and a new one opens after `retryDelay`, so a tab behind such a proxy does
 *   not open a new server stream every `silenceMs`. Keep-alives restart that wait only once a state
 *   has arrived, so a connection that only ever sends keep-alives does not pass for a working one.
 *
 * Each failure in a row, silence included, waits longer before the next source opens
 * (`retryDelay`); a well-formed state starts the count again. The returned function stops it for
 * good.
 */
export function connectTimerStream(
  open: () => TimerEventSource,
  handlers: TimerStreamHandlers,
  { retry: schedule = DEFAULT_RETRY, silenceMs = DEFAULT_SILENCE_MS }: TimerStreamOptions = {},
): () => void {
  let source: TimerEventSource | null = null;
  // Sources closed for an error, an unreadable event or silence since the last well-formed state.
  let failures = 0;
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

    const down = () => {
      delivered = false;
      quiet();
      setUp(false);
    };
    const reopenLater = () => {
      current.close();
      if (stopped) return;
      retry = setTimeout(connect, retryDelay(failures, schedule));
      failures += 1;
    };
    // Restarts the wait for the next event on the open source.
    const watch = () => {
      quiet();
      if (stopped) return;
      silence = setTimeout(() => {
        silence = null;
        down();
        reopenLater();
      }, silenceMs);
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
      failures = 0;
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
