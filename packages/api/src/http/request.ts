/** Readers for what a request carries: its JSON or text body, its client address and its cookies. */
import type { Request } from 'express';
import { invalidInput } from '../lib/errors.ts';
import type { JsonBody } from '../lib/values.ts';

/** Bodies arrive as raw text (see createApp), so a missing or wrong Content-Type is not an error. */
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

export function readJsonArray(req: Request): unknown[] {
  const body = parseBody(req);
  if (!Array.isArray(body)) throw invalidInput('Invalid JSON input: expected an array');
  return body;
}

export function readText(req: Request): string {
  return typeof req.body === 'string' ? req.body : '';
}

/**
 * The client address used for rate limiting. With TOKKL_TRUST_PROXY, Express takes it from the
 * X-Forwarded-For entry the outermost trusted proxy appended, which the client cannot forge.
 */
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
