/** The machine's clock. It fits the domain's `Clock` port. */
export const systemClock = Object.freeze({ now: (): Date => new Date() });

/** The current instant as an ISO string, as rows and tokens store it. */
export const now = (): string => new Date().toISOString();
