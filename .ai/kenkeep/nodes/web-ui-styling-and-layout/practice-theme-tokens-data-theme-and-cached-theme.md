---
type: practice
title: 'Theme: light-dark() tokens, data-theme and the cached theme'
description: >-
  Tokens are light-dark() on :root; [data-theme] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
tags:
  - web
  - css
  - theme
  - dark-mode
  - e2e
kk_schema_version: 3
kk_id: practice-theme-tokens-data-theme-and-cached-theme
kk_derived_from: []
kk_relates_to:
  - practice-contrast-tables-and-project-colours
  - practice-e2e-test-workflow
  - practice-end-sessions-through-lib-session
kk_depends_on: []
kk_confidence: high
---
Each colour in `packages/web/src/styles.css` is written once on `:root` as `light-dark(light, dark)`; alias tokens such as `--state-running` point at another token (`--accent-pink`). The scheme is the `color-scheme` on `<html>`: `:root[data-theme='light']` and `:root[data-theme='dark']` set only `color-scheme`, and with no attribute the system preference decides. Per-theme values belong in the `light-dark()` pair, not in token overrides under `[data-theme]`.

The production build (Vite 8, lightningcss) rewrites `light-dark()` into `--lightningcss-light` / `--lightningcss-dark` fallback variables that `:root` and the two `[data-theme]` rules switch. The tokens resolve on `:root` and children inherit the resolved value, so `color-scheme` on a nested element does not flip them in the build. `npm run test:e2e` builds first, so specs see the lowered CSS. A spec that needs a token's value in the other scheme opens a fresh browser context with that `colorScheme` emulated, as `e2e/theme.spec.ts` does, instead of reading a probe element that has its own `color-scheme`.

The cached theme lives in localStorage under `tokkl.theme`. A value left under the pre-rename key `timetrack.theme` is copied to `tokkl.theme` when that is empty and then removed; `theme-boot.js` and `theme.ts` both do this. `packages/web/public/theme-boot.js` is a plain blocking `<script src>` in the head of `packages/web/index.html`; it reads the key and sets `data-theme` on `<html>` before the first paint. The module bundle does not block rendering, so the theme cannot wait for it. The CSP in `packages/api/src/app.ts` has `script-src 'self'` and allows no inline script, hence a separate file. It is served by the plain `express.static` with no long cache, so browsers revalidate it on each load instead of keeping a stale copy.

`packages/web/src/lib/theme.ts` (imported first by `packages/web/src/main.tsx`) applies the cached value again as a fallback and owns the cache: `applyTheme` (called from `App.tsx` once preferences load) sets the attribute, writes the cache and updates both media-scoped `theme-color` metas in `index.html` (an explicit theme writes its colour into both; "Match the system" restores each tag's own colour). "Match the system" removes the key, and `endSession` in `packages/web/src/lib/session.ts` calls `clearCachedTheme` on logout (successful or not) and when `/me` answers 403. Both keys are spelled in `theme-boot.js` and in `STORAGE_KEY` and `LEGACY_STORAGE_KEY` in `theme.ts`, with comments pointing at each other; change both together. `e2e/theme.spec.ts` fails if they drift.

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [practice-e2e-test-workflow](../tooling-and-project/practice-e2e-test-workflow.md)
- Related: [practice-end-sessions-through-lib-session](../web-ui-behaviour/practice-end-sessions-through-lib-session.md)
<!-- kk:related:end -->
