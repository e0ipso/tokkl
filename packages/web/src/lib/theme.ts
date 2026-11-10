import type { Preferences } from '@tokkl/types';

// Cached so public/theme-boot.js can set the theme before first paint, before server preferences load.
// Applied again here in case that script did not run.

// public/theme-boot.js reads the same keys and migrates the old one the same way; change both together.
const STORAGE_KEY = 'tokkl.theme';
/** Pre-rename key: read once, copied to STORAGE_KEY, then removed. */
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

function writeCache(theme: Theme): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (theme === 'system') window.localStorage.removeItem(STORAGE_KEY);
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

// index.html has one theme-color meta per scheme; an explicit theme writes its colour into both,
// "Match the system" restores each.
const themeColorTags = Array.from(
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][media]'),
  (meta): { meta: HTMLMetaElement; scheme: Scheme; colour: string } => ({
    meta,
    scheme: meta.media.includes('dark') ? 'dark' : 'light',
    colour: meta.content,
  }),
);

function setThemeColor(theme: Theme): void {
  const target = theme === 'system' ? null : themeColorTags.find(tag => tag.scheme === theme);
  for (const tag of themeColorTags) tag.meta.content = (target ?? tag).colour;
}

/** Also caches it for the next page load. */
export function applyTheme(theme: Theme): void {
  setAttribute(theme);
  setThemeColor(theme);
  writeCache(theme);
}

/** For the login page after a session ends. */
export function clearCachedTheme(): void {
  applyTheme('system');
}

const cached = readCache();
if (cached === 'light' || cached === 'dark') {
  setAttribute(cached);
  setThemeColor(cached);
}
