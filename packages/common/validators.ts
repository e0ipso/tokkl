/** Checks for untyped JSON values. They answer false or null rather than throwing, so callers pick the message. */

/** RFC 3339 date-time with seconds and an explicit "Z" or numeric offset (upper-case T and Z only). */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** Rejects 2026-02-30 instead of rolling it into March. */
function isRealDateTime(parts: number[]): boolean {
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

/** Null for strings without a zone, impossible dates, offsets past 23:59 and non-strings. Keeps fractions. */
export function instantMilliseconds(value: unknown): number | null {
  const match = typeof value === 'string' ? RFC3339.exec(value) : null;
  if (!match) return null;
  const [offsetHours, offsetMinutes] = [match[7], match[8]].map(part => Number(part ?? 0)) as [number, number];
  if (!isRealDateTime(match.slice(1, 7).map(Number)) || offsetHours > 23 || offsetMinutes > 59) return null;
  const ms = Date.parse(value as string);
  return Number.isNaN(ms) ? null : ms;
}

export function isInstant(value: unknown): value is string {
  return instantMilliseconds(value) !== null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
