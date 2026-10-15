import type { DurationFormat } from '@tokkl/types';

const UNIT_SECONDS: Record<string, number> = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
};

/**
 * Parses what a person types into a duration field and returns whole seconds.
 *
 * Accepted: "1:30" (h:mm), "1:30:15" (h:mm:ss), "90" (minutes), "1.5" or "1,5h"
 * (decimal hours when a unit or separator says so), "1h 30m", "1h30m", "45s".
 * Returns null for anything else.
 */
export function parseDuration(raw: string): number | null {
  const input = raw.trim().toLowerCase().replace(',', '.');
  if (input === '') return null;

  const colon = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(input);
  if (colon) {
    const [, h, m, s] = colon;
    if (Number(m) > 59 || Number(s ?? 0) > 59) return null;
    return Number(h) * 3600 + Number(m) * 60 + Number(s ?? 0);
  }

  // A bare integer means minutes, a bare decimal means hours.
  if (/^\d+$/.test(input)) return Number(input) * 60;
  if (/^\d*\.\d+$/.test(input)) return Math.round(Number(input) * 3600);

  const unitPattern = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z]+)/g;
  let total = 0;
  let consumed = '';
  for (const match of input.matchAll(unitPattern)) {
    const seconds = UNIT_SECONDS[match[2]!];
    if (seconds === undefined) return null;
    total += Number(match[1]) * seconds;
    consumed += match[0];
  }
  if (consumed.replace(/\s+/g, '') !== input.replace(/\s+/g, '')) return null;
  return Math.round(total);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDuration(totalSeconds: number, format: DurationFormat = 'improved'): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (format === 'decimal') return `${(seconds / 3600).toFixed(2)} h`;

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (format === 'classic') {
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    if (m > 0) return `${m}:${pad(s)} min`;
    return `${s} sec`;
  }
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** Compact form for totals and chart labels, e.g. "12h 05m". */
export function formatHoursMinutes(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
