const TIME_OF_DAY = /^(\d{1,2})(?:[:.]?(\d{2}))?(?::\d{2})?(a|am|p|pm)?$/;

function matchTimeOfDay(raw: string): RegExpExecArray | null {
  return TIME_OF_DAY.exec(raw.trim().toLowerCase().replace(/\s+/g, ''));
}

/**
 * Accepts "9", "930", "9:30", "9.30", "9:30:15", "9a", "9pm" and "12am". A suffix is never second-guessed.
 * Without one, 12-hour users get Toggl's AM/PM guess: the first after `after`, else the nearest `reference`.
 */
export function parseTimeOfDay(
  raw: string,
  options: { twelveHour?: boolean; reference?: number; after?: number } = {},
): number | null {
  const match = matchTimeOfDay(raw);
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
  if (options.twelveHour && hour >= 1 && hour <= 11) {
    const am = hour * 60 + minute;
    const pm = am + 12 * 60;
    const { after } = options;
    if (after !== undefined) {
      const wait = (candidate: number) => (candidate - after + 24 * 60) % (24 * 60);
      return wait(pm) < wait(am) ? pm : am;
    }
    if (options.reference !== undefined) {
      return Math.abs(pm - options.reference) < Math.abs(am - options.reference) ? pm : am;
    }
  }
  return hour * 60 + minute;
}
