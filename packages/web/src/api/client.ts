/** Every request, downloads included, goes through `send`: CSRF header, credentials, deadlines and error decoding. */

import type { Decoder } from './decode.ts';
import { t } from '../i18n/messages.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  readonly status: number;
  /** JSON that was not a plain string, such as the timer state a 409 carries. */
  readonly body: unknown;
  /** Set when the error came from `send`. */
  readonly request: { readonly method: Method; readonly path: string } | null;

  constructor(status: number, message: string, body?: unknown, request?: { method: Method; path: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.request = request ?? null;
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/** The server may still have acted, so for a write the outcome is unknown. */
export class RequestTimeoutError extends Error {
  readonly request: { readonly method: Method; readonly path: string };

  constructor(method: Method, path: string) {
    super(t('api.timedOut'));
    this.name = 'RequestTimeoutError';
    this.request = { method, path };
  }
}

/** A 2xx reply whose body is not JSON; for a write the outcome is unknown. */
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
 * Includes the reply body. Writes wait longer, since giving up leaves their outcome unknown. Downloads:
 * `DOWNLOAD_START_MS`.
 */
export const DEADLINE_MS = { read: 20_000, write: 30_000, transfer: 300_000 } as const;

/** Only until the reply starts; the server streams at the client's pace and drops a client that stops reading. */
export const DOWNLOAD_START_MS = DEADLINE_MS.transfer;

type RequestKind = keyof typeof DEADLINE_MS;

/** Sent as it is, with its own content type. */
interface RawBody {
  readonly raw: string;
  readonly contentType: string;
}

export function rawBody(raw: string, contentType: string): RawBody {
  return { raw, contentType };
}

function isRawBody(body: unknown): body is RawBody {
  return typeof body === 'object' && body !== null && 'raw' in body && 'contentType' in body;
}

/** A raw body is an upload, a GET a read, the rest writes. */
export function requestKind(method: Method, body: unknown, kind?: RequestKind): RequestKind {
  if (kind) return kind;
  if (isRawBody(body)) return 'transfer';
  return method === 'GET' ? 'read' : 'write';
}

export interface RequestOptions<T> {
  /** JSON-encoded unless it is a `RawBody`. */
  body?: unknown;
  /** Forward it only for reads: a cancelled write may still have reached the server. */
  signal?: AbortSignal;
  /** Defaults to `requestKind`. */
  kind?: RequestKind;
  /** A write whose reply nothing reads passes none. */
  decode?: Decoder<T>;
  /** A repeat with the same key answers the record the first one made (see idempotency.ts). */
  idempotencyKey?: string;
}

function isDeadline(error: unknown, deadline: AbortSignal): boolean {
  return deadline.aborted && error instanceof DOMException && error.name === 'TimeoutError';
}

/** A timeout fails with `RequestTimeoutError`; a cancel by `signal` keeps its error, so TanStack sees it cancelled. */
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

/** Throws an `ApiError` for a status outside 2xx. */
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

export async function request<T = void>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const ms = DEADLINE_MS[requestKind(method, options.body, options.kind)];
  const text = await withDeadline(ms, { method, path }, options.signal, async signal => {
    const response = await send(method, path, options.body, signal, options.idempotencyKey);
    return response.text();
  });
  const value = parseReply(text, method, path);
  return options.decode ? options.decode(value) : (value as T);
}

/** Cancels the download, body included; it then fails with the signal's reason. */
interface DownloadRequest {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

/** The reply must start within `DOWNLOAD_START_MS`; the body takes as long as it takes. A cancel is never a timeout. */
export async function fetchDownload(
  path: string,
  { method = 'GET', body, signal }: DownloadRequest = {},
): Promise<Blob> {
  signal?.throwIfAborted();
  // A controller the body read outlives: an AbortSignal.timeout would cut the body off later.
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('No reply in time', 'TimeoutError')),
    DOWNLOAD_START_MS,
  );
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

/** Through fetch, not a followed link, so a refusal shows the server's message. A cancelled download saves nothing. */
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

const write =
  (method: Exclude<Method, 'GET'>) =>
  <T = void>(path: string, body?: unknown, options: Options<T> = {}): Promise<T> =>
    request<T>(method, path, { ...options, body });

export const api = {
  get: <T>(path: string, options: Options<T>) => request<T>('GET', path, options),
  post: write('POST'),
  put: write('PUT'),
  patch: write('PATCH'),
  delete: write('DELETE'),
};
