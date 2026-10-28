export interface OverlapEntry {
  id: number;
  start: string;
  stop: string | null;
  all_day: boolean;
}

/**
 * Ids of finished timed entries whose time range overlaps another timed entry. Toggl allows
 * overlaps; we only flag them. No-time entries have no clock range, so they are left out.
 */
export function overlappingIds(entries: OverlapEntry[]): Set<number> {
  const sorted = entries.filter((e) => e.stop && !e.all_day).sort((a, b) => a.start.localeCompare(b.start));
  const ids = new Set<number>();
  let latest: OverlapEntry | null = null;
  for (const entry of sorted) {
    if (latest && Date.parse(entry.start) < Date.parse(latest.stop!)) {
      ids.add(entry.id);
      ids.add(latest.id);
    }
    if (!latest || Date.parse(entry.stop!) > Date.parse(latest.stop!)) latest = entry;
  }
  return ids;
}
