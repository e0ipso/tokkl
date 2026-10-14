/**
 * Fixed-window failure counter keyed by client address. Only failed attempts count,
 * so a correct password always works once the window has passed.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures: number, windowMs: number) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (entry.resetAt <= now) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.failures.size > 10_000) this.prune(now);
      return;
    }
    entry.count++;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(key);
  }
}
