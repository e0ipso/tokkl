/**
 * Typed readers for query parameters and loosely typed body fields. Each keeps the API's existing
 * answer for invalid input: some refuse it with a 400, and Toggl's paging fields fall back to their
 * defaults, as Toggl does.
 */
import type { Request } from 'express';
import { invalidInput } from '../lib/errors.ts';
import { parseIdList } from '../lib/values.ts';
import type { PageWindow } from '../lib/pagination.ts';

/** First value of a query parameter, or undefined. */
export function query(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Every string value of a repeated query parameter, such as `user=a&user=b`; undefined when absent. */
export function queryList(req: Request, name: string): string[] | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  return [value].flat().filter((item): item is string => typeof item === 'string');
}

/** `true` or `1`; anything else, absent included, is false. */
export function queryFlag(req: Request, name: string): boolean {
  const value = query(req, name);
  return value === 'true' || value === '1';
}

/** A non-empty query value, or undefined for an absent or empty one. */
export function queryText(req: Request, name: string): string | undefined {
  return query(req, name) || undefined;
}

/** One of `allowed`, `fallback` when absent, else a 400 with `message`. */
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

/** A comma-separated id list such as `client_ids=1,2`; undefined when absent or empty. */
export function queryIds(req: Request, name: string, limit: number): number[] | undefined {
  const value = query(req, name);
  return value ? parseIdList(value, limit) : undefined;
}

/**
 * Toggl's lenient paging number: a value that is not a non-zero number, such as `abc`, `0` or an
 * empty string, means `fallback`. Callers clamp the result.
 */
export function lenientNumber(value: unknown, fallback: number): number {
  return Number(value ?? fallback) || fallback;
}

export interface PageLimits {
  defaultPerPage: number;
  maxPerPage: number;
}

/** A 1-based page and its size from lenient inputs, clamped to at least 1 and `maxPerPage`. */
export function pageWindow(page: unknown, perPage: unknown, limits: PageLimits): PageWindow {
  return {
    page: Math.max(lenientNumber(page, 1), 1),
    perPage: Math.min(Math.max(lenientNumber(perPage, limits.defaultPerPage), 1), limits.maxPerPage),
  };
}

/** The `page`/`per_page` query window, or undefined when the request asks for neither. */
export function optionalPageWindow(req: Request, limits: PageLimits): PageWindow | undefined {
  const page = query(req, 'page');
  const perPage = query(req, 'per_page');
  if (page === undefined && perPage === undefined) return undefined;
  return pageWindow(page, perPage, limits);
}
