import { badRequest } from './errors.ts';

/** Toggl serialises timestamps as RFC 3339 with an explicit "+00:00" offset. */
export function togglTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return `${iso.slice(0, 19)}+00:00`;
}

/** RFC 3339 date-time with seconds and an explicit "Z" or numeric offset (upper-case T and Z only). */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** True when the fields name a real calendar date and time of day, so 2026-02-30 is not rolled into March. */
function isRealDateTime(parts: number[]): boolean {
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && hour <= 23 && minute <= 59 && second <= 59;
}

/**
 * Parses an RFC 3339 timestamp and truncates it to whole seconds. Timestamps without a zone,
 * impossible dates and non-string values are rejected rather than guessed.
 */
export function parseInstant(value: unknown, field: string): Date {
  const invalid = () => badRequest(`Invalid ${field}: expected an RFC 3339 timestamp`);
  const match = typeof value === 'string' ? RFC3339.exec(value) : null;
  if (!match) throw invalid();
  const [offsetHours, offsetMinutes] = [match[7], match[8]].map((part) => Number(part ?? 0)) as [number, number];
  if (!isRealDateTime(match.slice(1, 7).map(Number)) || offsetHours > 23 || offsetMinutes > 59) throw invalid();
  const ms = Date.parse(value as string);
  if (Number.isNaN(ms)) throw invalid();
  return new Date(Math.floor(ms / 1000) * 1000);
}

export function isoSeconds(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

export function optionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 0) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  throw badRequest(`Invalid ${field}`);
}

export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  throw badRequest(`Invalid ${field}: expected a boolean`);
}

export function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`Invalid ${field}: expected a string`);
  if (value.length > maxLength) throw badRequest(`${field} must be at most ${maxLength} characters`);
  return value;
}

export function optionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw badRequest(`Invalid ${field}: expected a non-negative number`);
}

export function requireName(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${field} can't be blank`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest(`${field} must be at most ${maxLength} characters`);
  return trimmed;
}

export function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Parses "1,2,3" path segments into ids. */
export function parseIdList(value: string, limit = 100): number[] {
  const ids = value.split(',').map((part) => Number(part.trim()));
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw badRequest('Invalid ID list');
  }
  if (ids.length > limit) throw badRequest(`At most ${limit} IDs per request`);
  return [...new Set(ids)];
}

export function parseId(value: string | string[] | undefined): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid ID');
  return id;
}

/** Accepts "YYYY-MM-DD" or an RFC 3339 timestamp; returns null for "YYYY-MM-DD" so the caller can apply a timezone. */
export function parseDateOrInstant(value: string, field: string): { date: string } | { instant: Date } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  return { instant: parseInstant(value, field) };
}
