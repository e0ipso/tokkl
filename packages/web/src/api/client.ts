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
 * A 2xx reply whose body is not JSON. The server answered, so for a write it may have acted, and
 * the outcome is unknown. It keeps the parser's message.
 */
export class UnparsableReplyError extends SyntaxError {
  readonly request: { readonly method: Method; readonly path: string };

  constructor(method: Method, path: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'UnparsableReplyError';
    this.request = { method, path };
  }
}

function parseReply(text: string, method: Method, path: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UnparsableReplyError(method, path, error);
  }
}

/**
 * How long a request may take, reply body included, before it is given up:
 * - `read` (20 s): a GET, or a report query sent as a POST. TanStack Query retries a failed read,
 *   so a stalled one gives way to a fresh attempt.
 * - `write` (30 s): any other request. It waits longer, because giving up on a write leaves its
 *   outcome unknown.
 * - `transfer` (5 min): an import upload, which can carry a whole account's entries. A download
 *   (an export or a CSV report) gets it only for its reply to start: see `DOWNLOAD_START_MS`.
 */
export const DEADLINE_MS = { read: 20_000, write: 30_000, transfer: 300_000 } as const;

/**
 * How long a download's reply may take to start. The server may queue a download behind others
 * before it answers. Once the reply starts there is no client deadline: the server streams a
 * large export at the pace the client reads and drops a client that stops reading, and that
 * drop fails the download here as a network error.
 */
export const DOWNLOAD_START_MS = DEADLINE_MS.transfer;

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
   * for reads, a GET or a report query sent as a POST with `kind: 'read'`: a cancelled write may
   * still have reached the server.
   */
  signal?: AbortSignal;
  /** Which deadline applies (see `DEADLINE_MS`). By default it follows from the method and body (`requestKind`). */
  kind?: RequestKind;
  /**
   * Checks the reply (see decode.ts). Every request passes one: a write whose reply nothing reads
   * passes `ignoreReply` and gets nothing back, so no reply reaches a view or the cache unchecked.
   */
  decode: Decoder<T>;
  /**
   * Sent as the `Idempotency-Key` header of a create, so a repeat of the same request with the same
   * key answers the record the first one made instead of making another (see idempotency.ts).
   */
  idempotencyKey?: string;
}

declare const checked: unique symbol;

/**
 * A reply its decoder checked. Every request returns one, so code that writes a reply into the
 * cache asks for `Checked<T>` and cannot be handed a value from anywhere else.
 */
export type Checked<T> = T & { readonly [checked]: true };

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
async function send(
  method: Method,
  path: string,
  body: unknown,
  signal: AbortSignal,
  idempotencyKey?: string,
): Promise<Response> {
  const { payload, contentType } = encode(body);
  const headers: Record<string, string> = { 'X-Tokkl-CSRF': '1' };
  if (contentType) headers['Content-Type'] = contentType;
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal });
  if (!response.ok) throw await apiError(response, method, path);
  return response;
}

/** Sends a request and returns its reply, checked by `options.decode`. */
export async function request<T>(method: Method, path: string, options: RequestOptions<T>): Promise<Checked<T>> {
  const ms = DEADLINE_MS[requestKind(method, options.body, options.kind)];
  const text = await withDeadline(ms, { method, path }, options.signal, async signal => {
    const response = await send(method, path, options.body, signal, options.idempotencyKey);
    return response.text();
  });
  // The decoder checked every field `T` names; the brand records that for the compiler.
  return options.decode(parseReply(text, method, path)) as Checked<T>;
}

/**
 * A download request. `signal` cancels it, reply body included, such as when the view that started
 * it goes away; the download then fails with the signal's reason.
 */
export interface DownloadRequest {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Sends a download request and reads the whole reply. The reply must start within `startMs`; the
 * body then takes as long as it takes. A refusal, such as a 503 from a full download lane or a 403
 * for a lost session, fails with its `ApiError` and the server's message. A cancel by `signal`, at
 * any point, fails with the signal's reason, never as timed out.
 */
export async function fetchDownload(
  path: string,
  { method = 'GET', body, signal }: DownloadRequest = {},
  startMs: number = DOWNLOAD_START_MS,
): Promise<Blob> {
  signal?.throwIfAborted();
  // A controller the body read outlives: an AbortSignal.timeout would cut the body off later.
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('No reply in time', 'TimeoutError')), startMs);
  try {
    let response: Response;
    try {
      response = await send(method, path, body, controller.signal);
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new RequestTimeoutError(method, path);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return await response.blob();
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Sends a request and saves the reply as a file. Exports go through fetch too, not through a link
 * the browser follows: a followed link cannot show the server's message for a refusal, and the
 * caller could not tell when the file is done. A download cancelled by `request.signal` saves
 * nothing, even when its body had already arrived.
 */
export async function download(path: string, filename: string, request: DownloadRequest = {}): Promise<void> {
  const blob = await fetchDownload(path, request);
  request.signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Options<T> = Omit<RequestOptions<T>, 'body'>;

/**
 * A write. It checks its reply like a read, or says it reads none (`ignoreReply`), so a reply the
 * app shows or caches is never trusted unchecked.
 */
const write =
  (method: Exclude<Method, 'GET'>) =>
  <T>(path: string, body: unknown, options: Options<T>): Promise<Checked<T>> =>
    request<T>(method, path, { ...options, body });

export const api = {
  /** A read. Every GET feeds a query, and so the cache. */
  get: <T>(path: string, options: Options<T>) => request<T>('GET', path, options),
  post: write('POST'),
  put: write('PUT'),
  patch: write('PATCH'),
  delete: write('DELETE'),
};
