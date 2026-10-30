import { parseDateKey } from '@tokkl/common/time';
import type { JsonObject, JsonValue, UtcInstant, DateOnly } from './domain.ts';

// Errors describe the expected representation, never the stored value.
export function safeInteger(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'bigint' && !(typeof value === 'string' && /^-?\d+$/.test(value))) {
    throw new Error('Invalid storage integer');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Invalid storage integer');
  return number;
}
export function entityId(value: unknown): number {
  const number = safeInteger(value);
  if (number <= 0) throw new Error('Invalid storage ID');
  return number;
}
/** Rates/decimals are bounded JS numbers; IDs, durations and aggregate counts use safeInteger. */
export function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) {
    throw new Error('Invalid storage number');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid storage number');
  return number;
}
export function booleanValue(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === '1' || value === 't' || value === 'true') return true;
  if (value === false || value === 0 || value === 0n || value === '0' || value === 'f' || value === 'false') return false;
  throw new Error('Invalid storage boolean');
}
function copyJson(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Invalid storage JSON');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, (item) => copyJson(item, ancestors));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Invalid storage JSON');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}
export function jsonValue(value: unknown): JsonValue {
  try {
    return copyJson(typeof value === 'string' ? JSON.parse(value) : value, new Set());
  } catch {
    throw new Error('Invalid storage JSON');
  }
}
export function jsonObject(value: unknown): JsonObject {
  const normalized = jsonValue(value);
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('Invalid storage JSON object');
  return normalized;
}
/** Native timestamps must be configured in UTC; text timestamps must explicitly carry their zone. */
export function utcInstant(value: unknown): UtcInstant {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== 'string') throw new Error('Invalid storage instant');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !parseDateKey(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || Number(match[6] ?? 0) > 23 || Number(match[7] ?? 0) > 59) throw new Error('Invalid storage instant');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid storage instant');
  return date.toISOString();
}
export function dateOnly(value: unknown): DateOnly {
  if (typeof value !== 'string' || !parseDateKey(value)) throw new Error('Invalid storage date');
  return value;
}

/** For native SQL timestamp text only, on sessions explicitly configured to UTC by the factory. */
export function utcSqlInstant(value: unknown): UtcInstant {
  if (typeof value !== 'string') throw new Error('Invalid storage instant');
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(Z|[+-]\d{2}(?::\d{2})?)?$/.exec(value);
  if (!match) throw new Error('Invalid storage instant');
  let zone = match[3] ?? 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  return utcInstant(`${match[1]}T${match[2]}${zone}`);
}
