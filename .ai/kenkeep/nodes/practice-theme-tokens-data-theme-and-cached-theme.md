---
type: practice
title: 'Theme: light-dark() tokens, data-theme and the cached theme'
description: >-
  Colour tokens are light-dark() on :root; [data-theme] only sets color-scheme.
  The build lowers light-dark(), so nested schemes don't flip.
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
kk_depends_on: []
kk_confidence: high
---
Each colour in `web/src/styles.css` is written once on `:root` as `light-dark(light, dark)`; alias tokens such as `--accent-soft` point at another token. The scheme is the `color-scheme` on `<html>`: `:root[data-theme='light']` and `:root[data-theme='dark']` set only `color-scheme`, and with no attribute the system preference decides. Per-theme values belong in the `light-dark()` pair, not in token overrides under `[data-theme]`.

The production build (Vite 8, lightningcss) rewrites `light-dark()` into `--lightningcss-light` / `--lightningcss-dark` fallback variables that `:root` and the two `[data-theme]` rules switch. The tokens resolve on `:root` and children inherit the resolved value, so `color-scheme` on a nested element does not flip them in the build. `npm run test:e2e` builds first, so specs see the lowered CSS. A spec that needs a token's value in the other scheme opens a fresh browser context with that `colorScheme` emulated, as `e2e/theme.spec.ts` does, instead of reading a probe element that has its own `color-scheme`.

`web/src/lib/theme.ts` caches the applied theme in localStorage under `timetrack.theme` and puts it on `<html>` when the module loads, which is why `web/src/main.tsx` imports it first. `applyTheme` (called from `App.tsx` once preferences load) writes the cache, "Match the system" removes the key, and both logout paths (`App.tsx`, `SettingsPage.tsx`) call `clearCachedTheme`. The CSP in `server/src/app.ts` has `script-src 'self'` and allows no inline script, so this cannot move into an inline `<script>` in `web/index.html`.

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
