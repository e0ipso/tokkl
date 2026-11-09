/**
 * Recovery for a page module that fails to load. After a deploy an open tab still names the old
 * chunk files, which the server no longer has, and only a fresh page load knows the new names. A
 * failed load is tried once more, in case the network dropped it; if that fails too the tab reloads
 * once, and the sessionStorage flag set before the reload keeps a reload that does not help from
 * repeating. Only then does the load fail and the route's error screen show.
 */

/** The sessionStorage key set just before a reload for a failed page load. */
export const PAGE_RELOAD_KEY = 'tokkl.pageReload';

/** Runs `read` on the tab's session storage, or answers `fallback` when the storage is unusable. */
function withStorage<T>(read: (storage: Storage) => T, fallback: T): T {
  try {
    return read(window.sessionStorage);
  } catch {
    return fallback;
  }
}

/**
 * Runs `load` with the recovery above. A load that succeeds clears the flag, so the next deploy may
 * reload this tab again. While the tab reloads the promise never settles. A prefetch passes
 * `mayReload: false`: hovering a link must not reload the page, so where it would reload it fails.
 */
export async function loadPageModule<T>(load: () => Promise<T>, { mayReload = true } = {}): Promise<T> {
  for (let failures = 1; ; failures++) {
    try {
      const loaded = await load();
      withStorage(storage => storage.removeItem(PAGE_RELOAD_KEY), undefined);
      return loaded;
    } catch (error) {
      if (failures < 2) continue;
      // Unreadable storage counts as reloaded and a flag that does not stick blocks the reload, so no reload loops.
      const reloaded = withStorage(storage => storage.getItem(PAGE_RELOAD_KEY) !== null, true);
      const marked = () =>
        withStorage(storage => {
          storage.setItem(PAGE_RELOAD_KEY, '1');
          return true;
        }, false);
      if (!reloaded && mayReload && marked()) {
        window.location.reload();
        return new Promise<T>(() => {});
      }
      throw error;
    }
  }
}
