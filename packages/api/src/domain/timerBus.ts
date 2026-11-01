/** A hint that a user's committed timer revision changed. It never carries state. */
export type TimerSignal = { userId: number; revision: number };
/** Carries timer signals between API processes. A receiver rebuilds state from its own database read. */
export interface TimerBus {
  send(signal: TimerSignal): void;
  /** Registers the single receiver. */
  receive(handler: (signal: TimerSignal) => void): void;
  close(): Promise<void>;
}
/** One process: local commits already deliver their own state, so nothing is sent or received. */
export function createLocalTimerBus(): TimerBus {
  return { send() {}, receive() {}, async close() {} };
}
