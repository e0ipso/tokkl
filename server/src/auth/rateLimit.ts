interface Entry {
  failures: number;
  resetAt: number;
  /** Attempts holding a slot while their password check runs. */
  inFlight: number;
  /** Attempts waiting for an in-flight check to settle. */
  waiters: Array<() => void>;
}

/**
 * Fixed-window failure counter keyed by client address. Only failed attempts count,
 * so a correct password always works once the window has passed.
 *
 * Password checks run through `attempt`, which counts checks still in progress against the
 * remaining allowance. Parallel requests therefore cannot all start a check before the first
 * failure is recorded. Extra attempts wait for a running check to settle, up to `maxFailures`
 * waiters per address; beyond that, or once the limit is reached, they are refused unchecked.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();

  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures: number, windowMs: number) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.current(key, now);
    return entry !== undefined && entry.failures >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    this.addFailure(this.entries.get(key) ?? this.create(key, now), now);
  }

  /** Clears the failure count. Checks still running for the key keep their slots. */
  reset(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.failures = 0;
    this.settle(key, entry);
  }

  /**
   * Runs `check` under the limit and records a failure when it returns false. Returns null,
   * without calling `check`, when the address is blocked. A thrown error records nothing.
   */
  async attempt(key: string, check: () => Promise<boolean>): Promise<boolean | null> {
    if (!(await this.acquire(key))) return null;
    let failed = false;
    try {
      const valid = await check();
      failed = !valid;
      return valid;
    } finally {
      this.release(key, failed);
    }
  }

  private async acquire(key: string): Promise<boolean> {
    for (;;) {
      const now = Date.now();
      const entry = this.current(key, now) ?? this.create(key, now);
      if (entry.failures >= this.maxFailures) return false;
      if (entry.failures + entry.inFlight < this.maxFailures) {
        entry.inFlight++;
        return true;
      }
      if (entry.waiters.length >= this.maxFailures) return false;
      await new Promise<void>((resolve) => entry.waiters.push(resolve));
    }
  }

  private release(key: string, failed: boolean): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.inFlight--;
    if (failed) this.addFailure(entry, Date.now());
    // Woken attempts re-check the limit; those still without a slot queue again.
    for (const wake of entry.waiters.splice(0)) wake();
    this.settle(key, entry);
  }

  /** The key's entry, with failures from an expired window cleared. */
  private current(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.failures > 0 && entry.resetAt <= now) {
      entry.failures = 0;
      this.settle(key, entry);
    }
    return this.entries.get(key);
  }

  private addFailure(entry: Entry, now: number): void {
    if (entry.resetAt <= now) entry.failures = 0;
    if (entry.failures === 0) entry.resetAt = now + this.windowMs;
    entry.failures++;
  }

  private create(key: string, now: number): Entry {
    if (this.entries.size >= 10_000) this.prune(now);
    const entry: Entry = { failures: 0, resetAt: now + this.windowMs, inFlight: 0, waiters: [] };
    this.entries.set(key, entry);
    return entry;
  }

  /** Drops an entry that no longer holds failures, running checks or waiters. */
  private settle(key: string, entry: Entry): void {
    if (entry.failures === 0 && entry.inFlight === 0 && entry.waiters.length === 0) this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.failures > 0 && entry.resetAt <= now) entry.failures = 0;
      this.settle(key, entry);
    }
  }
}
