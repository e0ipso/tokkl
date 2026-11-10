/** A client that lost the reply to a create resends it with the same key and gets the original result. */
import { sha256 } from './crypto.ts';
import { invalidInput } from './errors.ts';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** One to 255 visible ASCII characters, such as a UUID. */
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export interface IdempotencyClaim {
  key: string;
  /** Equal for the same method, path, query and JSON body, whatever its key order. */
  fingerprint: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonical((value as Record<string, unknown>)[key]);
  return sorted;
}

/** A body that is not JSON is taken as its text. */
function bodyDigestInput(body: string): unknown {
  try {
    return { json: canonical(JSON.parse(body)) };
  } catch {
    return { text: body };
  }
}

/** Undefined without the header; a 400 for an invalid key. `url` is the path with its query. */
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
