/**
 * Fetch wrapper for the server. Cookie auth plus the CSRF header the server requires for writes.
 * Every request, downloads included, goes through `send`, so headers, credentials, deadlines and
 * error decoding live in one place.
 */

import type { Decoder } from './decode.ts';
import { t } from '../i18n/messages.ts';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A failed request: the reply's status, its decoded body and the request it answered. */
export class ApiError extends Error {
  readonly status: number;
  /** The reply's body when it was JSON that was not a plain string, such as the timer state a 409 carries. */
  readonly body: unknown;
  /** The request that failed, when the error came from `send`. */
  readonly request: { readonly method: Method; readonly path: string } | null;

  constructor(status: number, message: string, body?: unknown, request?: { method: Method; path: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.request = request ?? null;
  }
}

/** Whether `error` is a server reply with `status`. */
export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/**
 * A request that got no whole reply within its deadline. The server may still have acted on it, so
 * for a write the outcome is unknown.
 */
export class RequestTimeoutError extends Error {
  readonly request: { readonly method: Method; readonly path: string };

  constructor(method: Method, path: string) {
    super(t('api.timedOut'));
    this.name = 'RequestTimeoutError';
    this.request = { method, path };
  }
}

/**
 * How long a request may take, reply body included, before it is given up:
 * - `read` (20 s): a GET, or a report query sent as a POST. TanStack Query retries a failed read,
 *   so a stalled one gives way to a fresh attempt.
 * - `write` (30 s): any other request. It waits longer, because giving up on a write leaves its
 *   outcome unknown.
 * - `transfer` (5 min): an import upload, an export download or a CSV download, which can carry a
 *   whole account's entries.
 */
export const DEADLINE_MS = { read: 20_000, write: 30_000, transfer: 300_000 } as const;

export type RequestKind = keyof typeof DEADLINE_MS;

/** A body sent as it is, with its own content type, such as an uploaded CSV or JSON file. */
export interface RawBody {
  readonly raw: string;
  readonly contentType: string;
}

export function rawBody(raw: string, contentType: string): RawBody {
  return { raw, contentType };
}

function isRawBody(body: unknown): body is RawBody {
  return typeof body === 'object' && body !== null && 'raw' in body && 'contentType' in body;
}

/** The deadline a request gets unless it names one: a raw body is an upload, a GET a read, the rest writes. */
export function requestKind(method: Method, body: unknown, kind?: RequestKind): RequestKind {
  if (kind) return kind;
  if (isRawBody(body)) return 'transfer';
  return method === 'GET' ? 'read' : 'write';
}

export interface RequestOptions<T> {
  /** JSON-encoded unless it is a `RawBody`. */
  body?: unknown;
  /**
   * Cancels the request, such as the signal TanStack Query passes a query function. Forward it only
   * for GETs: a cancelled write may still have reached the server.
   */
  signal?: AbortSignal;
  /** Which deadline applies (see `DEADLINE_MS`). By default it follows from the method and body (`requestKind`). */
  kind?: RequestKind;
  /**
   * Checks the reply (see decode.ts). Without one the reply is trusted to match `T`, as for write
   * replies the views only refresh from: the server is this app's own same-origin API and both
   * sides compile against @tokkl/types.
   */
  decode?: Decoder<T>;
}

function isDeadline(error: unknown, deadline: AbortSignal): boolean {
  return deadline.aborted && error instanceof DOMException && error.name === 'TimeoutError';
}

/**
 * Runs `work` with a signal that aborts after `ms`, or earlier when `signal` does. Running out of
 * time fails with a `RequestTimeoutError`; a cancel by `signal` keeps its own error, so TanStack
 * Query still sees a cancelled query as cancelled.
 */
export async function withDeadline<T>(
  ms: number,
  request: { method: Method; path: string },
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline = AbortSignal.timeout(ms);
  try {
    return await work(signal ? AbortSignal.any([signal, deadline]) : deadline);
  } catch (error) {
    if (!signal?.aborted && isDeadline(error, deadline)) throw new RequestTimeoutError(request.method, request.path);
    throw error;
  }
}

async function apiError(response: Response, method: Method, path: string): Promise<ApiError> {
  const text = await response.text();
  const request = { method, path };
  let body: unknown;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') return new ApiError(response.status, parsed, undefined, request);
    body = parsed;
  } catch {
    // Plain-text body.
  }
  return new ApiError(
    response.status,
    text || response.statusText || t('api.requestFailed', { status: response.status }),
    body,
    request,
  );
}

function encode(body: unknown): { payload?: BodyInit; contentType?: string } {
  if (body === undefined) return {};
  if (isRawBody(body)) return { payload: body.raw, contentType: body.contentType };
  return { payload: JSON.stringify(body), contentType: 'application/json' };
}

/** Sends one request and returns the reply, or throws an `ApiError` for a status outside 2xx. */
async function send(method: Method, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const { payload, contentType } = encode(body);
  const headers: Record<string, string> = { 'X-Tokkl-CSRF': '1' };
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal });
  if (!response.ok) throw await apiError(response, method, path);
  return response;
}

export async function request<T>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const ms = DEADLINE_MS[requestKind(method, options.body, options.kind)];
  const text = await withDeadline(ms, { method, path }, options.signal, async signal => {
    const response = await send(method, path, options.body, signal);
    return response.text();
  });
  const value: unknown = text ? JSON.parse(text) : null;
  return options.decode ? options.decode(value) : (value as T);
}

/** Sends a request and saves the reply as a file, within the transfer deadline. */
export async function download(
  path: string,
  filename: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<void> {
  const blob = await withDeadline(DEADLINE_MS.transfer, { method, path }, undefined, async signal => {
    const response = await send(method, path, body, signal);
    return response.blob();
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Options<T> = Omit<RequestOptions<T>, 'body'>;

export const api = {
  get: <T>(path: string, options?: Options<T>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Options<T>) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Options<T>) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Options<T>) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: Options<T>) => request<T>('DELETE', path, { ...options, body }),
};
