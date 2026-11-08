/**
 * The `Idempotency-Key` request header of creates. A client that lost the reply to a create sends
 * the same request again with the same key and gets the original result instead of a second record.
 */
import { sha256 } from './crypto.ts';
import { invalidInput } from './errors.ts';

/** The request header a create reads its key from. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** One to 255 visible ASCII characters, such as a UUID. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/** A create's key and the digest of the request that came with it. */
export interface IdempotencyClaim {
  key: string;
  /** Equal for two requests with the same method, path, query and JSON body, whatever its key order. */
  fingerprint: string;
}

/** `value` with every object's keys in code-point order, so equal JSON bodies encode equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonical((value as Record<string, unknown>)[key]);
  return sorted;
}

/** The body as canonical JSON; a body that is not JSON is taken as its text. */
function bodyDigestInput(body: string): unknown {
  try {
    return { json: canonical(JSON.parse(body)) };
  } catch {
    return { text: body };
  }
}

/**
 * The claim of a request: undefined without the header, a 400 for a header that is not a valid key.
 * `url` is the path with its query, and `body` the raw request body.
 */
export function idempotencyClaim(
  header: string | undefined,
  request: { method: string; url: string; body: string },
): IdempotencyClaim | undefined {
  if (header === undefined) return undefined;
  if (!KEY_PATTERN.test(header))
    throw invalidInput(`Invalid ${IDEMPOTENCY_KEY_HEADER}: expected 1 to 255 visible ASCII characters`);
  const fingerprint = sha256(
    JSON.stringify({ method: request.method, url: request.url, body: bodyDigestInput(request.body) }),
  );
  return { key: header, fingerprint };
}
