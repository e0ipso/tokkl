import type { RateLimitChecks, RateLimitCounter } from '../domain/ports.ts';
import { sha256 } from '../lib/crypto.ts';
import { normalizeEmail } from '../domain/accountValues.ts';
import type { PasswordAttemptResult as AttemptResult } from '../domain/accounts.ts';

interface Counter {
  key: string;
  limit: number;
}

/** A plain key is one counter at `maxFailures`. A list charges every counter; any at its limit refuses. */
export type Keys = string | readonly Counter[];

/** For every password and setup code counter. */
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
/** One person at one machine. */
export const ACCOUNT_ADDRESS_LIMIT = 10;
/** Guessing spread over many hosts. */
const ACCOUNT_LIMIT = 50;
/** Spraying from one host, without locking out a shared NAT. */
export const ADDRESS_LIMIT = 100;
export const SETUP_CODE_LIMIT = 10;
export const SIGNUP_ADDRESS_LIMIT = 5;
export const SIGNUP_ADDRESS_WINDOW_MS = 15 * 60 * 1000;
export const SIGNUP_EMAIL_LIMIT = 3;
export const SIGNUP_EMAIL_WINDOW_MS = 60 * 60 * 1000;
/** Import starts per account, previews and refused or failed imports included. */
export const IMPORT_START_LIMIT = 5;
export const IMPORT_START_WINDOW_MS = 15 * 60 * 1000;

/** Cleared by a successful login. Accounts count by normalized email. */
export function accountCounters(email: string, address: string): Counter[] {
  const account = normalizeEmail(email);
  return [
    // JSON keeps the pair unambiguous whatever characters the email or address hold.
    { key: `account+address:${JSON.stringify([account, address])}`, limit: ACCOUNT_ADDRESS_LIMIT },
    { key: `account:${account}`, limit: ACCOUNT_LIMIT },
  ];
}

/** Password checks and link tokens share it, so guesses at either count toward one limit. */
export function addressCounter(address: string): Counter[] {
  return [{ key: `address:${address}`, limit: ADDRESS_LIMIT }];
}

export function passwordCounters(email: string, address: string): Counter[] {
  return [...accountCounters(email, address), ...addressCounter(address)];
}

/** Part of the stored key, so equal keys never collide. */
type LimiterNamespace = 'password' | 'setup-code' | 'signup-address' | 'signup-email' | 'import';

export type { AttemptResult };

/** Far longer than any check, so it expires only when its instance died; its failure still counts. */
const RESERVATION_LEASE_MS = 60 * 1000;

/** Fixed-window failure counter in the database. `attempt` reserves slots first, so parallel checks cannot overrun. */
export class FailureLimiter {
  private readonly limits: RateLimitChecks;
  private readonly namespace: LimiterNamespace;
  private readonly maxFailures: number;
  private readonly windowMs: number;

  /** Applies to plain string keys; counters carry their own. */
  constructor(limits: RateLimitChecks, namespace: LimiterNamespace, maxFailures: number, windowMs: number) {
    this.limits = limits;
    this.namespace = namespace;
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  /** Checks still running keep their slots. */
  async reset(keys: Keys): Promise<void> {
    await this.limits.reset(
      this.stored(keys).map(({ keyHash }) => keyHash),
      new Date().toISOString(),
    );
  }

  /** A false `check` records a failure on every counter; a throw records nothing. Refuses when blocked or full. */
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

  /** Until every counter now at its limit has reset, since any full counter refuses. Between 1 and the window. */
  private secondsUntil(resetAts: readonly string[], now: number): number {
    if (resetAts.length === 0) return 1;
    const seconds = Math.ceil((Math.max(...resetAts.map(at => Date.parse(at))) - now) / 1000);
    return Math.min(Math.max(seconds, 1), Math.ceil(this.windowMs / 1000));
  }

  /** Hashed, so the table holds no email or address. */
  private stored(keys: Keys): RateLimitCounter[] {
    const counters = typeof keys === 'string' ? [{ key: keys, limit: this.maxFailures }] : keys;
    return counters.map(({ key, limit }) => ({ keyHash: sha256(`${this.namespace}:${key}`), limit }));
  }
}
