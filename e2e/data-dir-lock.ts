import { createHash, randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

// A persistent TOKKL_E2E_DATA_DIR serves one run at a time. Global setup deletes every worker
// account it finds there, so a second run on the same directory would delete the first run's live
// accounts. playwright.config.ts claims the directory when the runner loads it, before Playwright
// starts the web servers (they start before global setup).
//
// The claim is `<dir>.lock`, holding the owner's process id, host name and a random id. The process
// that wrote it removes it when it exits. A run killed with SIGKILL cannot, so a lock whose process
// no longer runs on this host is stale and the next run takes it over.
//
// Several runs can find the same stale lock at once. Each file is only ever deleted by its owner or,
// once its owner is gone, by the one process holding the recovery guard named after that file's
// content (`<dir>.lock.recover-<hash>`). The guard holder deletes the file only if it still has that
// content, so nobody deletes a lock that a newer run has written. A guard whose holder died is
// stale in the same way and is recovered through its own guard.

const MAX_ATTEMPTS = 200;
const RETRY_MS = 5;
// A guard chain this deep needs four processes killed inside microsecond-long recoveries.
const MAX_GUARD_DEPTH = 4;

function readLock(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function owner(content: string): { pid: number; host: string } | null {
  try {
    const parsed = JSON.parse(content) as { pid?: unknown; host?: unknown };
    return typeof parsed.pid === 'number' && typeof parsed.host === 'string' ? { pid: parsed.pid, host: parsed.host } : null;
  } catch {
    return null;
  }
}

/** True only when the file's process is known to be gone. A file from another host is never stale. */
function isStale(content: string): boolean {
  const held = owner(content);
  if (!held || held.host !== hostname()) return false;
  try {
    process.kill(held.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** A new owner record. The random id keeps every record different, even if a pid is reused. */
function record(): string {
  return JSON.stringify({ pid: process.pid, host: hostname(), id: randomUUID() });
}

/**
 * Creates `path` holding `content` unless it exists. The content is written in full first and then
 * linked into place, so a reader never sees a half-written file.
 */
function createExclusive(path: string, content: string): boolean {
  const draft = `${path}.${process.pid}.${randomUUID()}.draft`;
  writeFileSync(draft, content);
  try {
    linkSync(draft, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(draft, { force: true });
  }
}

/** Deletes `path` if it still holds `content`. Only call it on a path nobody else may delete. */
function removeIfUnchanged(path: string, content: string): void {
  if (readLock(path) === content) unlinkSync(path);
}

/**
 * Deletes `path`, whose owner recorded in `stale` is gone, if it still holds `stale`. Returns false
 * when another live process is recovering the same file; the caller waits and looks again.
 */
function removeStale(lockPath: string, path: string, stale: string, depth = 0): boolean {
  if (depth > MAX_GUARD_DEPTH) {
    throw new Error(`Could not recover ${lockPath}: delete it and every ${lockPath}.recover-* file, then try again.`);
  }
  const guard = `${lockPath}.recover-${createHash('sha256').update(stale).digest('hex').slice(0, 16)}`;
  const mine = record();
  if (createExclusive(guard, mine)) {
    try {
      removeIfUnchanged(path, stale);
    } finally {
      removeIfUnchanged(guard, mine);
    }
    return true;
  }
  const held = readLock(guard);
  if (held === null) return true;
  if (!isStale(held)) return false;
  removeStale(lockPath, guard, held, depth + 1);
  return true;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Claims `dataDir` for this process, or throws when another live run holds it. Returns the release
 * function, which removes the lock only while it is still this process's.
 */
export function claimDataDir(dataDir: string): () => void {
  const lockPath = `${dataDir}.lock`;
  const content = record();
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (createExclusive(lockPath, content)) return () => removeIfUnchanged(lockPath, content);
    const held = readLock(lockPath);
    if (held === null) continue;
    if (!isStale(held)) {
      const by = owner(held);
      throw new Error(
        `TOKKL_E2E_DATA_DIR ${dataDir} is in use by another e2e run`
        + `${by ? ` (process ${by.pid} on ${by.host})` : ''}. Wait for it to finish or use another`
        + ` directory. If no run is using it, delete ${lockPath}.`,
      );
    }
    if (!removeStale(lockPath, lockPath, held)) pause(RETRY_MS);
  }
  throw new Error(`Could not claim TOKKL_E2E_DATA_DIR ${dataDir}: ${lockPath} kept changing. Try again.`);
}
