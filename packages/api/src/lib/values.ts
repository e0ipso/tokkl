/**
 * Readers for loosely typed JSON values. The command parsers build on these, so every field of one
 * kind is refused with the same message wherever it arrives.
 */
import { instantMilliseconds, isFiniteNumber, isSafeInteger } from '@tokkl/common/validators';
import { invalidInput } from './errors.ts';

/** A JSON object from a request body or an import file, before it is parsed. */
export type JsonBody = Record<string, unknown>;

/** Toggl serialises timestamps as RFC 3339 with an explicit "+00:00" offset. */
export function togglTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return `${iso.slice(0, 19)}+00:00`;
}

/**
 * Parses an RFC 3339 timestamp and truncates it to whole seconds. Timestamps without a zone,
 * impossible dates and non-string values are rejected rather than guessed.
 */
export function parseInstant(value: unknown, field: string): Date {
  const ms = instantMilliseconds(value);
  if (ms === null) throw invalidInput(`Invalid ${field}: expected an RFC 3339 timestamp`);
  return new Date(Math.floor(ms / 1000) * 1000);
}

export function isoSeconds(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

export function optionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 0) return null;
  if (isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  throw invalidInput(`Invalid ${field}`);
}

export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  throw invalidInput(`Invalid ${field}: expected a boolean`);
}

export function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidInput(`Invalid ${field}: expected a string`);
  if (value.length > maxLength) throw invalidInput(`${field} must be at most ${maxLength} characters`);
  return value;
}

export function optionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isFiniteNumber(value) && value >= 0) return value;
  throw invalidInput(`Invalid ${field}: expected a non-negative number`);
}

/** Highest hourly rate accepted. Keeps rate × 100 and billed amounts finite; larger rates overflow to Infinity in reports. */
const MAX_HOURLY_RATE = 1_000_000_000;

/** An optional hourly rate: a finite non-negative number up to MAX_HOURLY_RATE, or null. */
export function optionalRate(value: unknown, field: string): number | null | undefined {
  const rate = optionalNumber(value, field);
  if (rate != null && rate > MAX_HOURLY_RATE)
    throw invalidInput(`Invalid ${field}: expected at most ${MAX_HOURLY_RATE}`);
  return rate;
}

export function requireName(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalidInput(`${field} can't be blank`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw invalidInput(`${field} must be at most ${maxLength} characters`);
  return trimmed;
}

/** Parses "1,2,3" path segments into ids. */
export function parseIdList(value: string, limit = 100): number[] {
  const ids = value.split(',').map(part => Number(part.trim()));
  if (ids.length === 0 || ids.some(id => !isSafeInteger(id) || id <= 0)) {
    throw invalidInput('Invalid ID list');
  }
  if (ids.length > limit) throw invalidInput(`At most ${limit} IDs per request`);
  return [...new Set(ids)];
}

export function parseId(value: string | string[] | undefined): number {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!isSafeInteger(id) || id <= 0) throw invalidInput('Invalid ID');
  return id;
}

/** Accepts "YYYY-MM-DD" or an RFC 3339 timestamp; returns null for "YYYY-MM-DD" so the caller can apply a timezone. */
export function parseDateOrInstant(value: string, field: string): { date: string } | { instant: Date } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  return { instant: parseInstant(value, field) };
}
