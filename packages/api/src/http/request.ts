import express, { type Request, type RequestHandler } from 'express';
import { invalidInput } from '../lib/errors.ts';
import { IDEMPOTENCY_KEY_HEADER, idempotencyClaim, type IdempotencyClaim } from '../lib/idempotency.ts';
import type { JsonBody } from '../lib/values.ts';

/** Toggl clients may omit `Content-Type: application/json`, and imports send raw CSV or JSON. Over `limit`: 413. */
export const textBody = (limit: string | number): RequestHandler => express.text({ type: () => true, limit });

function parseBody(req: Request): unknown {
  const text = typeof req.body === 'string' ? req.body : '';
  try {
    return JSON.parse(text);
  } catch {
    throw invalidInput('Invalid JSON input');
  }
}

export function readJson(req: Request): JsonBody {
  const body = parseBody(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalidInput('Invalid JSON input');
  return body as JsonBody;
}

/** An empty object when the request sends no body. */
export function readOptionalJson(req: Request): JsonBody {
  return readText(req).trim() === '' ? {} : readJson(req);
}

export function readIdempotencyClaim(req: Request): IdempotencyClaim | undefined {
  return idempotencyClaim(req.get(IDEMPOTENCY_KEY_HEADER), {
    method: req.method,
    url: req.originalUrl,
    body: readText(req),
  });
}

export function readJsonArray(req: Request): unknown[] {
  const body = parseBody(req);
  if (!Array.isArray(body)) throw invalidInput('Invalid JSON input: expected an array');
  return body;
}

export function readText(req: Request): string {
  return typeof req.body === 'string' ? req.body : '';
}

/** With TOKKL_TRUST_PROXY, the X-Forwarded-For entry the outermost trusted proxy appended; clients cannot forge it. */
export function clientAddress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
