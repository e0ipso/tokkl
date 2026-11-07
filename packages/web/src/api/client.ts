/**
 * Fetch wrapper for the server. Cookie auth plus the CSRF header the server requires for writes.
 * Every request, downloads included, goes through `send`, so headers, credentials and error
 * decoding live in one place.
 */

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

/** Turns the decoded JSON of a reply into `T`, throwing when it does not fit. */
export type Decoder<T> = (value: unknown) => T;

export interface RequestOptions<T> {
  /** JSON-encoded unless it is a `RawBody`. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Checks the reply. Without one the reply is trusted to match `T`: the server is this app's own
   * same-origin API and both sides compile against @tokkl/types.
   */
  decode?: Decoder<T>;
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
    text || response.statusText || `Request failed (${response.status})`,
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
async function send(method: Method, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const { payload, contentType } = encode(body);
  const headers: Record<string, string> = { 'X-Tokkl-CSRF': '1' };
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal });
  if (!response.ok) throw await apiError(response, method, path);
  return response;
}

export async function request<T>(method: Method, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const response = await send(method, path, options.body, options.signal);
  const text = await response.text();
  const value: unknown = text ? JSON.parse(text) : null;
  return options.decode ? options.decode(value) : (value as T);
}

/** Sends a request and saves the reply as a file. */
export async function download(
  path: string,
  filename: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<void> {
  const response = await send(method, path, body);
  const url = URL.createObjectURL(await response.blob());
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
