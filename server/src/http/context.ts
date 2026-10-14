import type { Request } from 'express';
import type { Db } from '../db/index.ts';
import type { Config } from '../config.ts';
import type { UserRow } from '../models/users.ts';
import type { FailureLimiter } from '../auth/rateLimit.ts';
import { badRequest } from '../lib/errors.ts';

/** Shared by every router; created once in createApp. */
export interface Deps {
  db: Db;
  config: Config;
  /** Failed password attempts per client address, shared by the login form, setup and Basic auth. */
  loginLimiter: FailureLimiter;
}

declare module 'express-serve-static-core' {
  interface Locals {
    /** Set by requireAuth. */
    user: UserRow;
    authMethod: 'session' | 'basic';
  }
}

/** Bodies arrive as raw text (see createApp), so a missing or wrong Content-Type is not an error. */
function parseBody(req: Request): unknown {
  const text = typeof req.body === 'string' ? req.body : '';
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Invalid JSON input');
  }
}

export function readJson(req: Request): Record<string, unknown> {
  const body = parseBody(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid JSON input');
  return body as Record<string, unknown>;
}

export function readJsonArray(req: Request): unknown[] {
  const body = parseBody(req);
  if (!Array.isArray(body)) throw badRequest('Invalid JSON input: expected an array');
  return body;
}

export function readText(req: Request): string {
  return typeof req.body === 'string' ? req.body : '';
}

/** First value of a query parameter, or undefined. */
export function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function queryFlag(req: Request, name: string): boolean {
  const value = query(req, name);
  return value === 'true' || value === '1';
}

/**
 * The client address used for rate limiting. With TIMETRACK_TRUST_PROXY, Express takes it from the
 * last X-Forwarded-For hop, which the reverse proxy appends and the client cannot forge.
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
