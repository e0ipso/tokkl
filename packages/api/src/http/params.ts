/** Each keeps the API's existing answer for invalid input: a 400, or for Toggl's paging fields the default. */
import type { Request } from 'express';
import { invalidInput } from '../lib/errors.ts';
import { parseIdList } from '../lib/values.ts';
import type { PageWindow } from '../lib/pagination.ts';

export function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function queryList(req: Request, name: string): string[] | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  return [value].flat().filter((item): item is string => typeof item === 'string');
}

/** `true` or `1`; anything else is false. */
export function queryFlag(req: Request, name: string): boolean {
  const value = query(req, name);
  return value === 'true' || value === '1';
}

/** Undefined for an absent or empty value. */
export function queryText(req: Request, name: string): string | undefined {
  return query(req, name) || undefined;
}

export function queryChoice<const T extends string>(
  req: Request,
  name: string,
  allowed: readonly T[],
  fallback: T,
  message: string,
): T {
  const value = query(req, name);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw invalidInput(message);
  return value as T;
}

/** Toggl's `since`: Unix seconds, as an ISO instant. */
export function changedSince(req: Request): string | undefined {
  const since = query(req, 'since');
  if (since === undefined) return undefined;
  const date = new Date(Number(since) * 1000);
  if (!/^\d+$/.test(since) || Number.isNaN(date.getTime()))
    throw invalidInput('Since is expected to be an unix timestamp, integer value');
  return date.toISOString();
}

export function queryIds(req: Request, name: string, limit: number): number[] | undefined {
  const value = query(req, name);
  return value ? parseIdList(value, limit) : undefined;
}

/** Anything but a non-zero number (`abc`, `0`, '') means `fallback`. Callers clamp the result. */
export function lenientNumber(value: unknown, fallback: number): number {
  return Number(value ?? fallback) || fallback;
}

interface PageLimits {
  defaultPerPage: number;
  maxPerPage: number;
}

/** Clamped to at least 1 and `maxPerPage`. */
export function pageWindow(page: unknown, perPage: unknown, limits: PageLimits): PageWindow {
  return {
    page: Math.max(lenientNumber(page, 1), 1),
    perPage: Math.min(Math.max(lenientNumber(perPage, limits.defaultPerPage), 1), limits.maxPerPage),
  };
}

export function optionalPageWindow(req: Request, limits: PageLimits): PageWindow | undefined {
  const page = query(req, 'page');
  const perPage = query(req, 'per_page');
  if (page === undefined && perPage === undefined) return undefined;
  return pageWindow(page, perPage, limits);
}
