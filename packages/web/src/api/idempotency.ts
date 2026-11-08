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
 * (`isOutcomeUnknown`) goes out once more at once with its key, and if that outcome is unknown too,
 * the key is kept for that request: the user sending the very same request again, such as Save
 * clicked again on the form the error left open, reuses it, so a create that did land is answered
 * instead of made twice. Any reply the server gave, a refusal included, settles the intent, and the
 * next create gets a new key even for an identical request, such as the same duration added twice
 * on purpose.
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

/** The kept key of an unsettled create of `request`, or a new one. */
function intentOf(request: string, now: number): { key: string; since: number } {
  const kept = unsettled.get(request);
  return kept && now - kept.since < KEPT_KEY_MS ? kept : { key: newIdempotencyKey(), since: now };
}

/**
 * Sends the create `request` names (its method, path and body) through `send` under one key, and
 * once more with that key when the outcome is unknown. See the module comment.
 */
export async function sendCreate<T>(request: string, send: (key: string) => Promise<T>): Promise<T> {
  const intent = intentOf(request, Date.now());
  try {
    const reply = await send(intent.key).catch((error: unknown) => {
      if (isOutcomeUnknown(error)) return send(intent.key);
      throw error;
    });
    unsettled.delete(request);
    return reply;
  } catch (error) {
    if (isOutcomeUnknown(error)) unsettled.set(request, intent);
    else unsettled.delete(request);
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
