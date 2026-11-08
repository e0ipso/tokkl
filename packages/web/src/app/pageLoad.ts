/**
 * Recovery for a page module that fails to load. After a deploy an open tab still names the old
 * chunk files, which the server no longer has, and only a fresh page load knows the new names. A
 * failed load is tried once more, in case the network dropped it; if that fails too the tab reloads
 * once, and the sessionStorage flag set before the reload keeps a reload that does not help from
 * repeating. Only then does the load fail and the route's error screen show.
 */

/** What to do after a failed load. */
export type PageLoadStep = 'retry' | 'reload' | 'fail';

/** The sessionStorage key set just before a reload for a failed page load. */
export const PAGE_RELOAD_KEY = 'tokkl.pageReload';

/**
 * The step after `failures` failed loads in a row: retry after the first, then reload once unless
 * this tab already reloaded for a failed page load (`reloaded`), then fail.
 */
export function nextPageLoadStep(failures: number, reloaded: boolean): PageLoadStep {
  if (failures < 2) return 'retry';
  return reloaded ? 'fail' : 'reload';
}

/** Where the flag lives and how to reload; the browser's in the app, fakes in tests. */
export interface PageLoadEnvironment {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload: () => void;
}

const browser: PageLoadEnvironment = {
  storage: () => window.sessionStorage,
  reload: () => window.location.reload(),
};

/** Whether this tab reloaded for a failed page load. Unreadable storage counts as yes, so no reload can loop. */
function reloadedBefore(env: PageLoadEnvironment): boolean {
  try {
    return env.storage().getItem(PAGE_RELOAD_KEY) !== null;
  } catch {
    return true;
  }
}

/** Sets the flag, and says whether it stuck: without it a reload could repeat forever. */
function markReload(env: PageLoadEnvironment): boolean {
  try {
    env.storage().setItem(PAGE_RELOAD_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

function clearReload(env: PageLoadEnvironment): void {
  try {
    env.storage().removeItem(PAGE_RELOAD_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Runs `load` with the recovery above. A load that succeeds clears the flag, so the next deploy may
 * reload this tab again. While the tab reloads the promise never settles, so the route keeps its
 * loading state until the page goes away. A prefetch passes `mayReload: false`: hovering a link
 * must not reload the page the user is on, so where it would reload it fails instead.
 */
export async function loadPageModule<T>(
  load: () => Promise<T>,
  { mayReload = true, env = browser }: { mayReload?: boolean; env?: PageLoadEnvironment } = {},
): Promise<T> {
  for (let failures = 1; ; failures++) {
    try {
      const loaded = await load();
      clearReload(env);
      return loaded;
    } catch (error) {
      const step = nextPageLoadStep(failures, reloadedBefore(env));
      if (step === 'retry') continue;
      if (step === 'reload' && mayReload && markReload(env)) {
        env.reload();
        return new Promise<T>(() => {});
      }
      throw error;
    }
  }
}
