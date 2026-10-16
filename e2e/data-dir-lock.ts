import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

// A persistent TOKKL_E2E_DATA_DIR serves one run at a time. Global setup deletes every worker
// account it finds there, so a second run on the same directory would delete the first run's live
// accounts. playwright.config.ts claims the directory when the runner loads it, before Playwright
// starts the web servers (they start before global setup).
//
// The claim is `<dir>.lock`, holding the owner's process id and host name. The process that wrote
// it removes it when it exits. A run killed with SIGKILL cannot, so a lock whose process no longer
// runs on this host is stale and the next run takes it over.

function readLock(lockPath: string): string | null {
  try {
    return readFileSync(lockPath, 'utf8');
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

/** True only when the lock's process is known to be gone. A lock from another host is never stale. */
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

/**
 * Moves the stale lock aside and deletes it. If another run took the lock over in the meantime,
 * the file moved is that run's live lock, so it goes back.
 */
function removeStale(lockPath: string, stale: string): void {
  const aside = `${lockPath}.${process.pid}.stale`;
  try {
    renameSync(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    if (readLock(aside) !== stale) linkSync(aside, lockPath);
  } finally {
    rmSync(aside, { force: true });
  }
}

/**
 * Claims `dataDir` for this process, or throws when another live run holds it. Returns the release
 * function, which removes the lock only while it is still this process's.
 */
export function claimDataDir(dataDir: string): () => void {
  const lockPath = `${dataDir}.lock`;
  const content = JSON.stringify({ pid: process.pid, host: hostname() });
  mkdirSync(dirname(lockPath), { recursive: true });
  // Written in full first and then linked into place, so a reader never sees a half-written lock.
  const draft = `${lockPath}.${process.pid}.draft`;
  writeFileSync(draft, content);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(draft, lockPath);
        return () => {
          if (readLock(lockPath) === content) unlinkSync(lockPath);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
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
      removeStale(lockPath, held);
    }
    throw new Error(`Could not claim TOKKL_E2E_DATA_DIR ${dataDir}: ${lockPath} kept changing. Try again.`);
  } finally {
    rmSync(draft, { force: true });
  }
}
