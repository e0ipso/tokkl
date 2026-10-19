/**
 * Pause and resume in the timer bar. Pausing stops the running entry; resuming starts a clone of
 * it. The chain remembers what to clone and the seconds the stopped entries stored, so the clock
 * can show the total until Stop ends the chain.
 *
 * Plain TypeScript with no React or DOM, so node:test can load it.
 */

/** What Resume copies from the entry that was stopped. */
export interface ChainSnapshot {
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

export interface PauseChain {
  /** Seconds stored for the chain's stopped entries. */
  stoppedSeconds: number;
  snapshot: ChainSnapshot;
  /** The running clone's id, or null while paused. */
  runningId: number | null;
  /**
   * When the chain last changed, in ms. Current-entry data received before then may predate the
   * change, so `reconcile` ignores it.
   */
  since: number;
}

/** The fields of an entry the chain reads. */
export interface ChainEntry extends ChainSnapshot {
  id: number;
  start: string;
  stop: string | null;
  duration: number;
}

const KEY_PREFIX = 'tokkl.pauseChain.';
const VERSION = 1;

/** The localStorage key for one account, so another account on the same browser never sees it. */
export function chainKey(accountId: number): string {
  return `${KEY_PREFIX}${accountId}`;
}

export function snapshotOf(entry: ChainSnapshot): ChainSnapshot {
  return {
    description: entry.description, project_id: entry.project_id, task_id: entry.task_id,
    tags: [...entry.tags], billable: entry.billable,
  };
}

export function sameSnapshot(a: ChainSnapshot, b: ChainSnapshot): boolean {
  return a.description === b.description && a.project_id === b.project_id && a.task_id === b.task_id
    && a.billable === b.billable && a.tags.join('\u0000') === b.tags.join('\u0000');
}

/** Seconds a stopped entry stores: its span, which the server has already snapped. */
function storedSeconds(entry: ChainEntry): number {
  const span = entry.stop ? Math.floor((Date.parse(entry.stop) - Date.parse(entry.start)) / 1000) : entry.duration;
  return Number.isFinite(span) ? Math.max(0, span) : 0;
}

/**
 * The chain after `stopped` was paused. Pausing the running clone adds to the chain; pausing any
 * other entry starts a new one.
 */
export function pause(chain: PauseChain | null, stopped: ChainEntry, now: number): PauseChain {
  const carried = chain && chain.runningId === stopped.id ? chain.stoppedSeconds : 0;
  return { stoppedSeconds: carried + storedSeconds(stopped), snapshot: snapshotOf(stopped), runningId: null, since: now };
}

/** The chain once Resume started the clone `cloneId`. */
export function resume(chain: PauseChain, cloneId: number, now: number): PauseChain {
  return { ...chain, runningId: cloneId, since: now };
}

/** The paused chain with edits made while paused, which the next Resume uses. */
export function withSnapshot(chain: PauseChain, snapshot: ChainSnapshot): PauseChain {
  return { ...chain, snapshot: snapshotOf(snapshot) };
}

export function isPaused(chain: PauseChain | null): chain is PauseChain {
  return chain !== null && chain.runningId === null;
}

/**
 * The chain after the current entry loaded. `current` is undefined while it has not loaded and
 * null when nothing runs; `fetchedAt` is when that answer arrived. The chain ends (null) when a
 * paused chain sees a running entry, or when a running clone is gone or replaced by another entry.
 */
export function reconcile(chain: PauseChain | null, current: { id: number } | null | undefined, fetchedAt: number): PauseChain | null {
  if (!chain || current === undefined || fetchedAt <= chain.since) return chain;
  if (chain.runningId === null) return current === null ? chain : null;
  return current !== null && current.id === chain.runningId ? chain : null;
}

/**
 * Seconds the clock shows: the chain total while paused or while its clone runs, otherwise the
 * running entry's own elapsed time, and 0 when idle.
 */
export function chainSeconds(chain: PauseChain | null, current: { id: number; start: string } | null | undefined, now: number): number {
  if (current) {
    const elapsed = Math.max(0, Math.floor((now - Date.parse(current.start)) / 1000));
    return chain && chain.runningId === current.id ? chain.stoppedSeconds + elapsed : elapsed;
  }
  return isPaused(chain) ? chain.stoppedSeconds : 0;
}

/** The subset of Storage the chain uses, so tests can pass a stand-in. */
export interface ChainStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

function isId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

/** Reads a stored chain; anything unreadable counts as no chain. */
export function parseChain(text: string | null): PauseChain | null {
  if (text === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { v, stoppedSeconds, snapshot, runningId, since } = data as Record<string, unknown>;
  if (v !== VERSION || typeof stoppedSeconds !== 'number' || !Number.isFinite(stoppedSeconds) || stoppedSeconds < 0) return null;
  if (!isId(runningId) || typeof since !== 'number' || !Number.isFinite(since)) return null;
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.description !== 'string' || !isId(s.project_id) || !isId(s.task_id) || typeof s.billable !== 'boolean') return null;
  if (!Array.isArray(s.tags) || !s.tags.every((tag) => typeof tag === 'string')) return null;
  return {
    stoppedSeconds, runningId, since,
    snapshot: { description: s.description, project_id: s.project_id, task_id: s.task_id, tags: [...s.tags], billable: s.billable },
  };
}

export function serializeChain(chain: PauseChain): string {
  return JSON.stringify({ v: VERSION, ...chain });
}

/** The account's chain, or null. Blocked storage reads as no chain. */
export function loadChain(storage: ChainStorage, accountId: number): PauseChain | null {
  try {
    return parseChain(storage.getItem(chainKey(accountId)));
  } catch {
    return null;
  }
}

/** Stores the account's chain, or removes it for null. Blocked storage keeps the chain in memory only. */
export function saveChain(storage: ChainStorage, accountId: number, chain: PauseChain | null): void {
  try {
    if (chain) storage.setItem(chainKey(accountId), serializeChain(chain));
    else storage.removeItem(chainKey(accountId));
  } catch {
    // Storage can be blocked or full. The chain then lasts until the page reloads.
  }
}

/** Removes every account's chain, for sign-out. */
export function forgetChains(storage: ChainStorage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage can be blocked; then there is nothing stored to forget.
  }
}
