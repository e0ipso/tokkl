// Puts the cached theme on <html> before the first paint. index.html loads this as a plain
// script in the head, which blocks rendering; the module bundle does not, so on a cold cache the
// page would paint in the system theme until it arrived. The CSP allows no inline script
// (packages/api/src/app.ts), hence a separate file. web/src/lib/theme.ts writes the cache: keep the
// key in step with STORAGE_KEY there. e2e/theme.spec.ts fails if the two drift.
(function () {
  try {
    var theme = window.localStorage.getItem('timetrack.theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    // Storage can be blocked. The system decides until the server preference loads.
  }
})();
