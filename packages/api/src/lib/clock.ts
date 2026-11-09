/** The machine's clock. It fits the domain's `Clock` port. */
export const systemClock = Object.freeze({ now: (): Date => new Date() });
