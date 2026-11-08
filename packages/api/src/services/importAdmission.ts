/**
 * How many imports may run at once. An import holds one long transaction over a file of up to
 * 50 MB, so the server takes a few at a time, and one per account, and refuses the rest at once
 * instead of queueing them behind each other's guards.
 */
import { unavailable } from '../lib/errors.ts';

/** A refused import asks for a short wait, like a full report queue. */
export const IMPORT_BUSY_RETRY_SECONDS = 5;
const DEFAULT_MAX_IMPORTS = 4;
const DEFAULT_MAX_IMPORTS_PER_USER = 1;

export interface ImportAdmissionOptions {
  /** Imports running at once on this instance. Default 4. */
  maxImports?: number;
  /** Imports one account may run at once. Default 1; at most `maxImports`. */
  maxPerUser?: number;
}

/**
 * One admitted import. The place stays taken until the holder released it and every piece of work
 * it was lent to has settled, so a request that ends early cannot free a place its transaction
 * still uses.
 */
export interface ImportPlace {
  /** Keeps the place until `work` settles too, and answers `work`. */
  during<T>(work: Promise<T>): Promise<T>;
  /** Gives the holder's claim back. Calling it again does nothing. */
  release(): void;
}

export interface ImportAdmission {
  /** Takes a place for `userId`, or throws a 503 with `Retry-After` when none is free. */
  admit(userId: number): ImportPlace;
}

export function createImportAdmission(options: ImportAdmissionOptions = {}): ImportAdmission {
  const maxImports = options.maxImports ?? DEFAULT_MAX_IMPORTS;
  const maxPerUser = options.maxPerUser ?? DEFAULT_MAX_IMPORTS_PER_USER;
  if (!Number.isSafeInteger(maxImports) || maxImports < 1) throw new Error('Invalid import limit');
  if (!Number.isSafeInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > maxImports)
    throw new Error('Invalid import limit per account');
  let running = 0;
  const perUser = new Map<number, number>();
  return {
    admit(userId) {
      if (running >= maxImports || (perUser.get(userId) ?? 0) >= maxPerUser)
        throw unavailable('Too many imports are running', IMPORT_BUSY_RETRY_SECONDS);
      running++;
      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      let holds = 1;
      let released = false;
      const drop = () => {
        if (--holds) return;
        running--;
        const left = perUser.get(userId)! - 1;
        if (left) perUser.set(userId, left);
        else perUser.delete(userId);
      };
      return {
        during(work) {
          if (!holds) throw new Error('The import place was given back');
          holds++;
          return work.finally(drop);
        },
        release() {
          if (released) return;
          released = true;
          drop();
        },
      };
    },
  };
}
