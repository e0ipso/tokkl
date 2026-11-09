import { request, type Checked, type RequestOptions } from './client.ts';
import type { Decoder } from './decode.ts';
import { isOutcomeUnknown } from './timerState.ts';

/**
 * Creates sent with an `Idempotency-Key`: v9 creates of entries, clients, projects, tasks and tags,
 * timer and Pomodoro starts, and entry splits. The server runs a create once per key for 24 hours:
 * the same key and request again answers the record as it is now (a 404 once deleted), and the
 * same key with another request is a 422.
 *
 * One key stands for one user intent, not one attempt. A create whose outcome is unknown
 * (`isOutcomeUnknown`) goes out once more with its key after a short wait (`retryWaitMs`): sent at
 * once, it would likely meet the same failure, such as a network that just dropped. From that
 * first unknown outcome on, the key is kept for that request: the user sending the very same request
 * again, during the wait or after the second attempt failed too, such as Save clicked again on the
 * form the error left open, reuses it, so a create that did land is answered instead of made twice.
 * Any reply the server gave, a refusal included, settles the intent, and the next create gets a new
 * key even for an identical request, such as the same duration added twice on purpose.
 */

/** How long a kept key is reused: less than the server's 24 hours, so it is never past its record. */
const KEPT_KEY_MS = 23 * 60 * 60 * 1000;

/** Keys of creates whose outcome is unknown, by the request they went out with, and when they first did. */
const unsettled = new Map<string, { key: string; since: number }>();

/**
 * A new key: 128 random bits as 32 hex characters, within the server's 1 to 255 visible ASCII
 * characters. `crypto.randomUUID` would need a secure context, and an instance may be served over
 * plain HTTP on a local network.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The shortest wait before a create whose outcome is unknown goes out again, as the desktop app waits. */
export const RETRY_MIN_MS = 1000;

/**
 * The wait before the second attempt: `RETRY_MIN_MS` plus a random part of up to a quarter of it,
 * so tabs that one outage failed together do not all come back in the same instant. `random` gives
 * a number from 0 (included) to 1 (excluded), as `Math.random` does.
 */
export function retryWaitMs(random: () => number): number {
  return RETRY_MIN_MS + Math.floor(random() * (RETRY_MIN_MS / 4));
}

/** How `sendCreate` waits before its second attempt: the random source and the timer. */
export interface RetryWait {
  random: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realWait: RetryWait = {
  random: Math.random,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/** The kept key of an unsettled create of `request`, or a new one. */
function intentOf(request: string, now: number): { key: string; since: number } {
  const kept = unsettled.get(request);
  return kept && now - kept.since < KEPT_KEY_MS ? kept : { key: newIdempotencyKey(), since: now };
}

/** Forgets the kept key of `request` once `intent`, and not a later one, is settled. */
function settle(request: string, intent: { key: string }): void {
  if (unsettled.get(request)?.key === intent.key) unsettled.delete(request);
}

/**
 * Sends the create `request` names (its method, path and body) through `send` under one key, and
 * once more with that key after `retryWaitMs` when the outcome is unknown. See the module comment.
 *
 * The wait is a timer and nothing else: it holds no view and no session, and the second attempt is
 * part of the same write, which, like any write, is never cancelled once sent, because the first
 * attempt may have landed.
 */
export async function sendCreate<T>(
  request: string,
  send: (key: string) => Promise<T>,
  wait: RetryWait = realWait,
): Promise<T> {
  const intent = intentOf(request, Date.now());
  try {
    const reply = await send(intent.key).catch(async (error: unknown) => {
      if (!isOutcomeUnknown(error)) throw error;
      unsettled.set(request, intent);
      await wait.sleep(retryWaitMs(wait.random));
      return send(intent.key);
    });
    settle(request, intent);
    return reply;
  } catch (error) {
    if (isOutcomeUnknown(error)) unsettled.set(request, intent);
    else settle(request, intent);
    throw error;
  }
}

type CreateOptions<T> = Omit<RequestOptions<T>, 'body' | 'idempotencyKey'>;

/** POSTs a create with an `Idempotency-Key` (`sendCreate`): `Checked` when given a decoder, trusted otherwise. */
export function postCreate<T>(
  path: string,
  body: unknown,
  options: CreateOptions<T> & { decode: Decoder<T> },
): Promise<Checked<T>>;
export function postCreate<T>(path: string, body: unknown, options?: CreateOptions<T>): Promise<T>;
export function postCreate<T>(path: string, body: unknown, options: CreateOptions<T> = {}): Promise<T> {
  return sendCreate(`POST ${path} ${JSON.stringify(body)}`, idempotencyKey =>
    request<T>('POST', path, { ...options, body, idempotencyKey }),
  );
}
