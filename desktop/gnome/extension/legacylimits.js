// The Pomodoro length limits for a tokkl-timerd older than the release that
// added the PomodoroLengthLimits property. The extension updates from
// extensions.gnome.org while the service comes from a package, so a new
// extension often talks to an older service; these are the ranges and
// defaults the preferences had built in before the service published them.
// A current service publishes PomodoroLengthLimits, from the shared core's
// rules, and these are not used. Remove this module once services without
// PomodoroLengthLimits are no longer supported.

/** @typedef {{min: number, max: number, default: number}} LengthLimit */

/** @type {Record<string, LengthLimit>} keyed as PomodoroLengths */
export const LEGACY_LENGTH_LIMITS = {
    work: { min: 1, max: 180, default: 25 },
    shortRest: { min: 1, max: 60, default: 5 },
    longRest: { min: 1, max: 60, default: 15 },
    longRestEvery: { min: 1, max: 12, default: 4 },
};

function usable(limit) {
    return (
        limit !== null &&
        typeof limit === 'object' &&
        [limit.min, limit.max, limit.default].every(Number.isInteger) &&
        limit.min <= limit.default &&
        limit.default <= limit.max
    );
}

/**
 * The range and default of each length, keyed as PomodoroLengths: the
 * PomodoroLengthLimits property, or the built-in limits for a service that
 * publishes none. A length the property leaves out, or gives no usable
 * range, keeps its built-in limit.
 *
 * @param {Record<string, LengthLimit> | null} published the property, or
 *     null without it
 * @returns {Record<string, LengthLimit>}
 */
export function lengthLimits(published) {
    if (!published || typeof published !== 'object') return LEGACY_LENGTH_LIMITS;
    return Object.fromEntries(
        Object.entries(LEGACY_LENGTH_LIMITS).map(([key, legacy]) => {
            const limit = published[key];
            return [key, usable(limit) ? { min: limit.min, max: limit.max, default: limit.default } : legacy];
        }),
    );
}
