interface Entry {
  failures: number;
  resetAt: number;
  /** Attempts holding a slot while their password check runs. */
  inFlight: number;
  /** Attempts waiting for an in-flight check to settle. */
  waiters: Array<() => void>;
}

/** One failure count an attempt is charged to, with its own limit. */
export interface Counter {
  key: string;
  limit: number;
}

/**
 * A plain key is a single counter at the limiter's `maxFailures`. A list charges every counter in
 * it, and the attempt is refused when any of them is at its limit.
 */
export type Keys = string | readonly Counter[];

/** Window for every password and setup code counter. */
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
/** Failures for one account from one address: one person at one machine. */
export const ACCOUNT_ADDRESS_LIMIT = 10;
/** Failures for one account from any address: guessing spread over many hosts. */
export const ACCOUNT_LIMIT = 50;
/** Failures from one address for any account: spraying from one host, without locking out a shared NAT. */
export const ADDRESS_LIMIT = 100;
/** Wrong setup codes from one address. */
export const SETUP_CODE_LIMIT = 10;

/**
 * Accounts are counted by trimmed email with only ASCII A-Z lowercased at every password check.
 * That matches users.email COLLATE NOCASE, so two emails share counters exactly when they are the
 * same account; toLowerCase would also fold letters such as Ä that SQLite keeps apart.
 */
export function normalizeEmail(email: string): string {
  return email.trim().replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** The counters a successful login clears: the account from this address, and the account. */
export function accountCounters(email: string, address: string): Counter[] {
  const account = normalizeEmail(email);
  return [
    // JSON keeps the pair unambiguous whatever characters the email or address hold.
    { key: `account+address:${JSON.stringify([account, address])}`, limit: ACCOUNT_ADDRESS_LIMIT },
    { key: `account:${account}`, limit: ACCOUNT_LIMIT },
  ];
}

/**
 * Failures from one address, whatever it tried. Password checks and one-time link tokens share it,
 * so guesses at either count toward one limit.
 */
export function addressCounter(address: string): Counter[] {
  return [{ key: `address:${address}`, limit: ADDRESS_LIMIT }];
}

/** Every counter a password check for `email` from `address` is charged to. */
export function passwordCounters(email: string, address: string): Counter[] {
  return [...accountCounters(email, address), ...addressCounter(address)];
}

/**
 * Fixed-window failure counter. Only failed attempts count, so a correct password always works
 * once the window has passed.
 *
 * Password checks run through `attempt`, which counts checks still in progress against the
 * remaining allowance of every counter they are charged to. Parallel requests therefore cannot all
 * start a check before the first failure is recorded. Extra attempts wait for a running check to
 * settle, up to a counter's limit in waiters; beyond that, or once any counter reaches its limit,
 * they are refused unchecked.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();

  private readonly maxFailures: number;
  private readonly windowMs: number;

  /** `maxFailures` is the limit for plain string keys; counters carry their own. */
  constructor(maxFailures: number, windowMs: number) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  isBlocked(keys: Keys, now = Date.now()): boolean {
    return this.counters(keys).some(({ key, limit }) => (this.current(key, now)?.failures ?? 0) >= limit);
  }

  recordFailure(keys: Keys, now = Date.now()): void {
    for (const { key } of this.counters(keys)) this.addFailure(this.entries.get(key) ?? this.create(key, now), now);
  }

  /** Clears the failure counts. Checks still running for a key keep their slots. */
  reset(keys: Keys): void {
    for (const { key } of this.counters(keys)) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.failures = 0;
      this.settle(key, entry);
    }
  }

  /**
   * Runs `check` under the limits and records a failure against every counter when it returns
   * false. Returns null, without calling `check`, when any counter is blocked. A thrown error
   * records nothing.
   */
  async attempt(keys: Keys, check: () => Promise<boolean>): Promise<boolean | null> {
    const counters = this.counters(keys);
    if (!(await this.acquire(counters))) return null;
    let failed = false;
    try {
      const valid = await check();
      failed = !valid;
      return valid;
    } finally {
      this.release(counters, failed);
    }
  }

  /**
   * Whole seconds, rounded up, until every counter now at its limit has reset. An attempt is refused
   * while any counter is full, so waiting for only the first to reset could still get a refusal. Call
   * it after `attempt` returned null or `isBlocked` returned true. It is never below 1 or above the window.
   * An attempt refused only because the queue behind a running check was full has no counter at its
   * limit, and gets 1 second. The result does not say which counter is full.
   */
  retryAfterSeconds(keys: Keys, now = Date.now()): number {
    const resets = this.counters(keys).flatMap(({ key, limit }) => {
      const entry = this.current(key, now);
      return entry && entry.failures >= limit ? [entry.resetAt] : [];
    });
    if (resets.length === 0) return 1;
    const seconds = Math.ceil((Math.max(...resets) - now) / 1000);
    return Math.min(Math.max(seconds, 1), Math.ceil(this.windowMs / 1000));
  }

  private counters(keys: Keys): readonly Counter[] {
    return typeof keys === 'string' ? [{ key: keys, limit: this.maxFailures }] : keys;
  }

  private async acquire(counters: readonly Counter[]): Promise<boolean> {
    for (;;) {
      const now = Date.now();
      const entries = counters.map(({ key }) => this.current(key, now));
      if (counters.some(({ limit }, i) => (entries[i]?.failures ?? 0) >= limit)) return false;
      const full = counters.findIndex(({ limit }, i) => {
        const entry = entries[i];
        return entry !== undefined && entry.failures + entry.inFlight >= limit;
      });
      if (full < 0) {
        for (const { key } of counters) (this.entries.get(key) ?? this.create(key, now)).inFlight++;
        return true;
      }
      const entry = entries[full]!;
      if (entry.waiters.length >= counters[full]!.limit) return false;
      await new Promise<void>((resolve) => entry.waiters.push(resolve));
    }
  }

  private release(counters: readonly Counter[], failed: boolean): void {
    const now = Date.now();
    for (const { key } of counters) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      entry.inFlight--;
      if (failed) this.addFailure(entry, now);
      // Woken attempts re-check the limits; those still without a slot queue again.
      for (const wake of entry.waiters.splice(0)) wake();
      this.settle(key, entry);
    }
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
