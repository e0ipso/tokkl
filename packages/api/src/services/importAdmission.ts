/** Imports hold a long transaction and their parsed records, so few run at once; the rest are refused, not queued. */
import { unavailable } from '../lib/errors.ts';

const IMPORT_BUSY_RETRY_SECONDS = 5;
const DEFAULT_MAX_IMPORTS = 4;
const DEFAULT_MAX_IMPORTS_PER_USER = 1;
/** Room for one 50 MB file and a few small ones; two large files never run together. */
const DEFAULT_MAX_IMPORT_BYTES = 64 * 1024 * 1024;

interface ImportAdmissionOptions {
  /** Default 4. */
  maxImports?: number;
  /** Default 1; at most `maxImports`. */
  maxPerUser?: number;
  /** Exceeded only when no other import runs, so any file within the body limit imports. Default 64 MiB. */
  maxBytes?: number;
}

/** Taken until released and every lent piece of work settled, so an early request end cannot free it. */
export interface ImportPlace {
  during<T>(work: Promise<T>): Promise<T>;
  /** Calling it again does nothing. */
  release(): void;
}

interface ImportAdmission {
  /** Throws a 503 with `Retry-After` when no place is free or the file does not fit beside the running ones. */
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
