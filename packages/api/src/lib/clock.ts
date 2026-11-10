export const systemClock = Object.freeze({ now: (): Date => new Date() });

/** As rows and tokens store it. */
export const now = (): string => new Date().toISOString();
