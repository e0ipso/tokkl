import { chainKey, parseChain, saveChain, type PauseChain } from './pauseChain.ts';

/**
 * The pause chain as this tab sees it. The timer bar and the app-level Pomodoro both pause the
 * running entry, and only one of them is mounted on most pages, so both read and write the chain
 * here. Writes reach the other one at once through `subscribeTabChain`; other tabs follow through
 * the storage event. When storage is blocked, the last chain written in this tab stands in.
 */

type Listener = (accountId: number, chain: PauseChain | null) => void;

let memory: { accountId: number; chain: PauseChain | null } | null = null;
const listeners = new Set<Listener>();

/** The account's chain: the stored one, or the last one written here when storage is blocked. */
export function readTabChain(accountId: number): PauseChain | null {
  if (!accountId) return null;
  try {
    return parseChain(window.localStorage.getItem(chainKey(accountId)));
  } catch {
    return memory?.accountId === accountId ? memory.chain : null;
  }
}

/** Stores the account's chain, or removes it for null, and tells this tab's listeners. */
export function writeTabChain(accountId: number, chain: PauseChain | null): void {
  if (!accountId) return;
  memory = { accountId, chain };
  try {
    saveChain(window.localStorage, accountId, chain);
  } catch {
    // Storage can be blocked. The chain then lasts until the page reloads.
  }
  for (const listener of listeners) listener(accountId, chain);
}

/** Calls `listener` after every write in this tab, including the listener's own. */
export function subscribeTabChain(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
