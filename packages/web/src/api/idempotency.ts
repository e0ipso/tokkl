import { request, type RequestOptions } from './client.ts';
import { isOutcomeUnknown } from './timerState.ts';

/**
 * One key per user intent: an unknown-outcome create is retried once with its key, and resending the same
 * request reuses it. Any server reply settles the intent; the next create gets a new key.
 */

/** Less than the server's 24 hours, so it is never past its record. */
const KEPT_KEY_MS = 23 * 60 * 60 * 1000;

/** By request, with when they first went out. */
const unsettled = new Map<string, { key: string; since: number }>();

/** `crypto.randomUUID` needs a secure context, and an instance may be served over plain HTTP. */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** As the desktop app waits. */
const RETRY_MIN_MS = 1000;

/** Plus up to a quarter more at random, so tabs one outage failed do not all return at once. */
function retryWaitMs(): number {
  return RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MIN_MS / 4));
}

/** Making a new key forgets kept keys past `KEPT_KEY_MS`, so the map does not grow. */
function intentOf(request: string, now: number): { key: string; since: number } {
  const kept = unsettled.get(request);
  if (kept && now - kept.since < KEPT_KEY_MS) return kept;
  for (const [sent, { since }] of unsettled) if (now - since >= KEPT_KEY_MS) unsettled.delete(sent);
  return { key: newIdempotencyKey(), since: now };
}

/** Only when `intent`, and not a later one, is settled. */
function settle(request: string, intent: { key: string }): void {
  if (unsettled.get(request)?.key === intent.key) unsettled.delete(request);
}

/** The wait holds no view or session, and the retry is never cancelled, since the first attempt may have landed. */
export async function sendCreate<T>(request: string, send: (key: string) => Promise<T>): Promise<T> {
  const intent = intentOf(request, Date.now());
  try {
    const reply = await send(intent.key).catch(async (error: unknown) => {
      if (!isOutcomeUnknown(error)) throw error;
      unsettled.set(request, intent);
      await new Promise(resolve => setTimeout(resolve, retryWaitMs()));
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

export function postCreate<T = void>(path: string, body: unknown, options: CreateOptions<T> = {}): Promise<T> {
  return sendCreate(`POST ${path} ${JSON.stringify(body)}`, idempotencyKey =>
    request<T>('POST', path, { ...options, body, idempotencyKey }),
  );
}
