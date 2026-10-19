import { chainKey, parseChain, saveChain, type PauseChain } from './pauseChain.ts';

/**
 * The pause chain as this tab sees it. The timer bar and the app-level Pomodoro both pause the
 * running entry, and only one of them is mounted on most pages, so both read and write the chain
 * here. Writes reach the other one at once through `subscribeTabChain`; other tabs follow through
 * the storage event. When storage is blocked, or refuses a write because it is full, the last
 * chain written in this tab stands in.
 */

type Listener = (accountId: number, chain: PauseChain | null) => void;

interface Written {
  accountId: number;
  chain: PauseChain | null;
  /**
   * Set when storage refused this write: what it held under the account's key at that moment.
   * Reads return `chain` while storage still holds that text. Another tab's change replaces it,
   * and that change wins.
   */
  refusedOver?: { stored: string | null };
}

let memory: Written | null = null;
const listeners = new Set<Listener>();

/** The text stored under the account's key, or null when there is none or storage is blocked. */
function storedText(accountId: number): string | null {
  try {
    return window.localStorage.getItem(chainKey(accountId));
  } catch {
    return null;
  }
}

/**
 * The account's chain: the stored one, or the last one written here when storage is blocked or
 * refused that write.
 */
export function readTabChain(accountId: number): PauseChain | null {
  if (!accountId) return null;
  try {
    const stored = window.localStorage.getItem(chainKey(accountId));
    if (memory?.accountId === accountId && memory.refusedOver && memory.refusedOver.stored === stored) return memory.chain;
    return parseChain(stored);
  } catch {
    return memory?.accountId === accountId ? memory.chain : null;
  }
}

/** Stores the account's chain, or removes it for null, and tells this tab's listeners. */
export function writeTabChain(accountId: number, chain: PauseChain | null): void {
  if (!accountId) return;
  const written: Written = { accountId, chain };
  memory = written;
  try {
    if (!saveChain(window.localStorage, accountId, chain)) written.refusedOver = { stored: storedText(accountId) };
  } catch {
    // Storage is blocked. The chain then lasts until the page reloads.
  }
  for (const listener of listeners) listener(accountId, chain);
}

/** Calls `listener` after every write in this tab, including the listener's own. */
export function subscribeTabChain(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
