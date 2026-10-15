// Puts the cached theme on <html> before the first paint. index.html loads this as a plain
// script in the head, which blocks rendering; the module bundle does not, so on a cold cache the
// page would paint in the system theme until it arrived. The CSP allows no inline script
// (packages/api/src/app.ts), hence a separate file. packages/web/src/lib/theme.ts writes the cache:
// keep both keys in step with STORAGE_KEY and LEGACY_STORAGE_KEY there. e2e/theme.spec.ts fails
// if they drift.
(function () {
  try {
    var storage = window.localStorage;
    var theme = storage.getItem('tokkl.theme');
    // Before the rename to Tokkl the cache was under timetrack.theme: move it to the new key once.
    var legacy = storage.getItem('timetrack.theme');
    if (legacy !== null) {
      if (theme === null && (legacy === 'light' || legacy === 'dark')) {
        theme = legacy;
        storage.setItem('tokkl.theme', legacy);
      }
      storage.removeItem('timetrack.theme');
    }
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    // Storage can be blocked. The system decides until the server preference loads.
  }
})();
