import { isTimerState } from './timerState.ts';
import type { TimerState } from '@tokkl/types';

/** So it can be driven without a browser. */
export interface TimerEventSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

interface TimerStreamHandlers {
  onState(state: TimerState): void;
  /** Called only on a change. See `connectTimerStream` for what counts. */
  onStatus(up: boolean): void;
}

const CLOSED = 2;
/** The server sends a `keep-alive` every 25 s. */
const SILENCE_MS = 60_000;
/** Also the `Retry-After` of a full stream cap, which `EventSource` cannot read. The longest is 60 s. */
const RETRY_BASE_MS = 5000;
const RETRY_CAP_MS = 60_000;

/** A random time from 5 s to a ceiling doubling per failure, up to 60 s, to spread tabs a restart dropped. */
export function retryDelay(failures: number): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures + 1));
  return Math.round(RETRY_BASE_MS + Math.random() * (ceiling - RETRY_BASE_MS));
}

/** Null when its data is not JSON or not a whole state. */
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
 * Up from the first well-formed state. Down on an error, an undecodable event or a minute of silence; a closed
 * or bad source is replaced after `retryDelay`. Keep-alives alone never count as up.
 */
export function connectTimerStream(open: () => TimerEventSource, handlers: TimerStreamHandlers): () => void {
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
      retry = setTimeout(connect, retryDelay(failures));
      failures += 1;
    };
    const watch = () => {
      quiet();
      if (stopped) return;
      silence = setTimeout(() => {
        silence = null;
        down();
        reopenLater();
      }, SILENCE_MS);
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
