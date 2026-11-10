import type { Clock } from '../../src/domain/ports.ts';

export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at) };
}

export function manualClock(start: Date): Clock & { set(at: Date): void } {
  let current = start;
  return {
    now: () => new Date(current),
    set(at) {
      current = at;
    },
  };
}

/** `time` is "HH:MM:SS" on 2026-10-14 UTC. */
export const at = (time: string) => new Date(`2026-10-14T${time}Z`);
