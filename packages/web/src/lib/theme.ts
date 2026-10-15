import type { Preferences } from '../api/types.ts';

// The theme lives in the server preferences, which load only after React mounts. To avoid a
// light frame for someone who chose dark, the last applied theme is cached here.
// packages/web/public/theme-boot.js, a blocking script in the head of index.html, reads the cache
// and puts the theme on <html> before the first paint. This module applies it again when it loads,
// in case that script did not run.

// packages/web/public/theme-boot.js reads the same keys and migrates the old one the same way;
// change both together.
const STORAGE_KEY = 'tokkl.theme';
/** The key used before the rename to Tokkl. Read once, copied to STORAGE_KEY, then removed. */
const LEGACY_STORAGE_KEY = 'timetrack.theme';

type Theme = Preferences['theme'];

function readCache(): string | null {
  try {
    const storage = window.localStorage;
    let theme = storage.getItem(STORAGE_KEY);
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      if (theme === null && (legacy === 'light' || legacy === 'dark')) {
        theme = legacy;
        storage.setItem(STORAGE_KEY, legacy);
      }
      storage.removeItem(LEGACY_STORAGE_KEY);
    }
    return theme;
  } catch {
    return null;
  }
}

function writeCache(theme: Theme | null): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
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

type Scheme = Exclude<Theme, 'system'>;

// index.html has one theme-color meta per colour scheme, holding that scheme's --bg. The browser
// picks one by media query, so an explicit theme writes its own colour into both tags, and
// "Match the system" puts each tag's original colour back.
const themeColorTags = Array.from(
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][media]'),
  (meta) => ({ meta, scheme: (meta.media.includes('dark') ? 'dark' : 'light') as Scheme, colour: meta.content }),
);

function setThemeColor(theme: Theme): void {
  const target = theme === 'system' ? null : themeColorTags.find((tag) => tag.scheme === theme);
  for (const tag of themeColorTags) tag.meta.content = (target ?? tag).colour;
}

/** Applies the theme from the server preferences and remembers it for the next page load. */
export function applyTheme(theme: Theme): void {
  setAttribute(theme);
  setThemeColor(theme);
  writeCache(theme);
}

/** Forgets the cached theme, so the login page after logout follows the system. */
export function clearCachedTheme(): void {
  writeCache(null);
}

const cached = readCache();
if (cached === 'light' || cached === 'dark') {
  setAttribute(cached);
  setThemeColor(cached);
}
