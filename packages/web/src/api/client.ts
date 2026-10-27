/** Fetch wrapper for the server. Cookie auth plus the CSRF header the server requires for writes. */

export class ApiError extends Error {
  readonly status: number;
  /** The reply's body when it was JSON that was not a plain string, such as the timer state a 409 carries. */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function apiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  let body: unknown;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') return new ApiError(response.status, parsed);
    body = parsed;
  } catch {
    // Plain-text body.
  }
  return new ApiError(response.status, text || response.statusText || `Request failed (${response.status})`, body);
}

export async function request<T>(method: Method, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Tokkl-CSRF': '1' };
  let payload: BodyInit | undefined;
  if (typeof body === 'string') {
    payload = body;
    headers['Content-Type'] = 'text/plain';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', ...init });
  if (!response.ok) throw await apiError(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** POSTs a body and saves the response as a file. */
export async function download(path: string, filename: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    headers: { 'X-Tokkl-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!response.ok) throw await apiError(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
