/**
 * How many imports may run at once. An import holds one long transaction over a file of up to
 * 50 MB, and its parsed records stay in memory until it commits, so the server takes a few at a
 * time, one per account, and only as many bytes of files at once as `maxBytes` allows. It refuses
 * the rest at once instead of queueing them behind each other's guards.
 */
import { unavailable } from '../lib/errors.ts';

/** A refused import asks for a short wait, like a full report queue. */
const IMPORT_BUSY_RETRY_SECONDS = 5;
const DEFAULT_MAX_IMPORTS = 4;
const DEFAULT_MAX_IMPORTS_PER_USER = 1;
/** Room for one 50 MB file and a few small ones; two large files never run together. */
const DEFAULT_MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface ImportAdmissionOptions {
  /** Imports running at once on this instance. Default 4. */
  maxImports?: number;
  /** Imports one account may run at once. Default 1; at most `maxImports`. */
  maxPerUser?: number;
  /**
   * File bytes the running imports may hold in all. An import that would pass it is refused,
   * unless no other import runs, so any file within the body limit can still be imported.
   * Default 64 MiB.
   */
  maxBytes?: number;
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
  /**
   * Takes a place for `userId`'s import of a file of `bytes`, or throws a 503 with `Retry-After`
   * when none is free or the file does not fit beside the running ones.
   */
  admit(userId: number, bytes: number): ImportPlace;
}

export function createImportAdmission(options: ImportAdmissionOptions = {}): ImportAdmission {
  const maxImports = options.maxImports ?? DEFAULT_MAX_IMPORTS;
  const maxPerUser = options.maxPerUser ?? DEFAULT_MAX_IMPORTS_PER_USER;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  if (!Number.isSafeInteger(maxImports) || maxImports < 1) throw new Error('Invalid import limit');
  if (!Number.isSafeInteger(maxPerUser) || maxPerUser < 1 || maxPerUser > maxImports)
    throw new Error('Invalid import limit per account');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid import byte limit');
  let running = 0;
  let held = 0;
  const perUser = new Map<number, number>();
  return {
    admit(userId, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid import size');
      if (running >= maxImports || (perUser.get(userId) ?? 0) >= maxPerUser || (running > 0 && held + bytes > maxBytes))
        throw unavailable('Too many imports are running', IMPORT_BUSY_RETRY_SECONDS);
      running++;
      held += bytes;
      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      let holds = 1;
      let released = false;
      const drop = () => {
        if (--holds) return;
        running--;
        held -= bytes;
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
