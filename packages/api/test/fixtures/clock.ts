import type { Clock } from '../../src/domain/ports.ts';

/** A clock that always reads `at`. */
export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at) };
}

/** A clock that reads what the test last set. */
export function manualClock(start: Date): Clock & { set(at: Date): void } {
  let current = start;
  return {
    now: () => new Date(current),
    set(at) {
      current = at;
    },
  };
}
