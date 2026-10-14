/**
 * Parses a typed clock time into minutes after midnight.
 *
 * Accepted: "9", "930", "0930", "9:30", "9.30", "9:30:15" (seconds dropped), "9a", "9pm", "12am".
 * Without a suffix, 24-hour input is taken literally. For 12-hour users, `reference` (minutes after
 * midnight) picks AM or PM for 1-11 like Toggl does: whichever is closer to the reference.
 */
export function parseTimeOfDay(raw: string, options: { twelveHour?: boolean; reference?: number } = {}): number | null {
  const input = raw.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?(?::\d{2})?(a|am|p|pm)?$/.exec(input);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3];
  if (minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix.startsWith('a')) hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return hour * 60 + minute;
  }
  if (hour > 23) return null;
  if (options.twelveHour && hour >= 1 && hour <= 11 && options.reference !== undefined) {
    const am = hour * 60 + minute;
    const pm = am + 12 * 60;
    return Math.abs(pm - options.reference) < Math.abs(am - options.reference) ? pm : am;
  }
  return hour * 60 + minute;
}
