/** Value rules for workspace settings, shared by workspace updates, projects and reports. */

/** Toggl's rounding direction: -1 down, 0 to the nearest step, 1 up. */
const ROUNDING_MODES = [-1, 0, 1] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];
/** Rounding steps Toggl accepts, in minutes. 0 turns rounding off. */
export const ROUNDING_MINUTES = [0, 1, 5, 6, 10, 12, 15, 30, 60, 240] as const;

export const isRoundingMode = (value: unknown): value is RoundingMode =>
  (ROUNDING_MODES as readonly unknown[]).includes(value);
export const isRoundingMinutes = (value: unknown): value is number =>
  (ROUNDING_MINUTES as readonly unknown[]).includes(value);

/** Three ASCII letters, the shape of an ISO 4217 code; stored upper-case. */
export const isCurrencyCode = (value: string): boolean => /^[A-Za-z]{3}$/.test(value);
