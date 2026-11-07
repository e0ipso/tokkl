import type { RateLimitCounter, RateLimitsRepository } from '../storage/contracts.ts';
import { sha256 } from '../lib/crypto.ts';
import { normalizeEmail } from '../domain/accountValues.ts';
import type { PasswordAttemptResult as AttemptResult } from '../domain/accounts.ts';

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
const ACCOUNT_LIMIT = 50;
/** Failures from one address for any account: spraying from one host, without locking out a shared NAT. */
export const ADDRESS_LIMIT = 100;
/** Wrong setup codes from one address. */
export const SETUP_CODE_LIMIT = 10;

/**
 * The counters a successful login clears: the account from this address, and the account. Accounts
 * are counted by their normalized email, so two emails share counters exactly when they are the
 * same account.
 */
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

/** Which limiter a counter belongs to. It is part of the stored key, so equal keys never collide. */
export type LimiterNamespace = 'password' | 'setup-code';

export type { AttemptResult };

/**
 * How long a reservation holds its slot. Far longer than any password check, so it only expires
 * when the instance holding it died. A check that outlives it frees its slot early, and its failure
 * still counts.
 */
const RESERVATION_LEASE_MS = 60 * 1000;

/**
 * Fixed-window failure counter, stored in the database and shared by every instance on it. Only
 * failed attempts count, so a correct password always works once the window has passed.
 *
 * Password checks run through `attempt`, which reserves a slot in every counter they are charged to
 * before the check runs. A counter refuses once its failures plus its live reservations reach its
 * limit, so parallel requests cannot all start a check before the first failure is recorded. An
 * attempt that finds every slot taken is refused at once, with nothing to wait for.
 */
export class FailureLimiter {
  private readonly limits: RateLimitsRepository;
  private readonly namespace: LimiterNamespace;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  /** `maxFailures` is the limit for plain string keys; counters carry their own. */
  constructor(limits: RateLimitsRepository, namespace: LimiterNamespace, maxFailures: number, windowMs: number) {
    this.limits = limits;
    this.namespace = namespace;
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  /** Clears the failure counts. Checks still running for a key keep their slots. */
  async reset(keys: Keys): Promise<void> {
    await this.limits.reset(
      this.stored(keys).map(({ keyHash }) => keyHash),
      new Date().toISOString(),
    );
  }

  /**
   * Runs `check` under the limits and records a failure against every counter when it returns
   * false. Without calling `check`, it refuses when any counter is blocked or has no free slot. A
   * thrown error releases the slots and records nothing. No transaction stays open while `check` runs.
   */
  async attempt(keys: Keys, check: () => Promise<boolean>): Promise<AttemptResult> {
    const counters = this.stored(keys);
    const now = Date.now();
    const reservation = await this.limits.reserve(
      counters,
      new Date(now).toISOString(),
      this.windowMs,
      RESERVATION_LEASE_MS,
    );
    if (!reservation.ok) {
      return {
        refused: true,
        retryAfter: reservation.reason === 'slots' ? 1 : this.secondsUntil(reservation.resetAts, now),
      };
    }
    let failed = false;
    try {
      const valid = await check();
      failed = !valid;
      return { refused: false, valid };
    } finally {
      await this.limits.release(reservation.reservations, counters, failed, new Date().toISOString(), this.windowMs);
    }
  }

  /**
   * Whole seconds, rounded up, until every counter now at its limit has reset. An attempt is refused
   * while any counter is full, so waiting for only the first to reset could still get a refusal. It is
   * never below 1 or above the window.
   */
  private secondsUntil(resetAts: readonly string[], now: number): number {
    if (resetAts.length === 0) return 1;
    const seconds = Math.ceil((Math.max(...resetAts.map(at => Date.parse(at))) - now) / 1000);
    return Math.min(Math.max(seconds, 1), Math.ceil(this.windowMs / 1000));
  }

  /** The counters as stored: hashed, so the table holds no email or address. */
  private stored(keys: Keys): RateLimitCounter[] {
    const counters = typeof keys === 'string' ? [{ key: keys, limit: this.maxFailures }] : keys;
    return counters.map(({ key, limit }) => ({ keyHash: sha256(`${this.namespace}:${key}`), limit }));
  }
}
