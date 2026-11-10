/**
 * After a deploy an open tab names chunk files the server no longer has. A failed load is retried, then the
 * tab reloads once; a sessionStorage flag keeps a useless reload from repeating.
 */

export const PAGE_RELOAD_KEY = 'tokkl.pageReload';

function withStorage<T>(read: (storage: Storage) => T, fallback: T): T {
  try {
    return read(window.sessionStorage);
  } catch {
    return fallback;
  }
}

/** Success clears the flag. While the tab reloads the promise never settles; `mayReload: false` fails instead. */
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
