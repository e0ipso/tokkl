import type { Preferences } from '../api/types.ts';

// The theme lives in the server preferences, which load only after React mounts. To avoid a
// light frame for someone who chose dark, the last applied theme is cached here and put on
// <html> when this module loads. main.tsx imports it first. The CSP allows no inline script
// (server/src/app.ts), so this cannot move into index.html.

const STORAGE_KEY = 'timetrack.theme';

type Theme = Preferences['theme'];

function readCache(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCache(theme: Theme | null): void {
  try {
    if (theme === null || theme === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked. The server preference still applies once it loads.
  }
}

function setAttribute(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

/** Applies the theme from the server preferences and remembers it for the next page load. */
export function applyTheme(theme: Theme): void {
  setAttribute(theme);
  writeCache(theme);
}

/** Forgets the cached theme, so the login page after logout follows the system. */
export function clearCachedTheme(): void {
  writeCache(null);
}

const cached = readCache();
if (cached === 'light' || cached === 'dark') setAttribute(cached);
