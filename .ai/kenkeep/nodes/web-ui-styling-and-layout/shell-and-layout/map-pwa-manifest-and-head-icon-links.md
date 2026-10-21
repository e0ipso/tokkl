---
type: map
title: 'PWA manifest and head icon links, and what e2e/pwa.spec.ts checks'
description: >-
  The manifest pins id and scope to /, uses #291329 and five pack icons;
  index.html links the ICO, two PNGs and four touch icons.
tags:
  - pwa
  - manifest
  - icons
  - favicon
  - web
  - testing
kk_schema_version: 3
kk_id: map-pwa-manifest-and-head-icon-links
kk_derived_from: []
kk_relates_to:
  - map-app-icons-script
  - practice-playwright-gotchas-in-the-e2e-specs
  - practice-theme-tokens-data-theme-and-cached-theme
  - map-app-shell-brand-and-navigation
kk_depends_on: []
kk_confidence: high
---
`packages/web/public/manifest.webmanifest` matches the icon pack's `docs/brand/icon-pack/web/public/manifest.webmanifest` with two exceptions. It keeps the app's own `description`, and it leaves out `icons/icon-1024.png`, which is too large to serve (see map-app-icons-script). `id`, `scope` and `start_url` are all `/`. The id fixes the install identity, so an installed app survives a later change to `start_url`; leave `id` at `/`. The root scope keeps every route inside the app window. `theme_color` and `background_color` are both `#291329`, the pack's background colour.

The manifest lists five PNG icons in a fixed order, each with an explicit `purpose`: `icons/icon-192.png` and `icons/icon-512.png` as `any`, then `icons/maskable-192.png`, `icons/maskable-512.png` and `icons/maskable-1024.png` as `maskable`. The general-purpose and maskable files stay separate entries, because a launcher crops a maskable icon to its own shape. Every entry declares `image/png` and its pixel size. `e2e/pwa.spec.ts` allows `"sizes": "any"` only on an `image/svg+xml` icon, and the pack has no SVG.

`packages/web/index.html` follows the pack's `head-snippet.html` for its icon tags, in this order: `/favicon.ico` with `sizes="16x16 32x32 48x48"`, `/icons/favicon-32.png`, `/icons/favicon-16.png`, then touch icons at `/icons/apple-touch-icon-120.png`, `-152.png` and `-167.png` and the root `/apple-touch-icon.png` for 180 px. iOS also tries that root path when a page links no touch icon. `/icons/favicon-48.png` and `/icons/apple-touch-icon-180.png` are served but not linked. The page keeps two `theme-color` metas, one per `prefers-color-scheme`, holding the light and dark `--bg`, because `packages/web/src/lib/theme.ts` rewrites both when an explicit theme overrides the system. Do not swap in the pack's single `theme-color` tag (see practice-theme-tokens-data-theme-and-cached-theme).

`e2e/pwa.spec.ts` checks all of this against the built app. For the manifest it checks `id` and `scope`, the two colours and the five-entry icon list. Each icon must be served with its declared type, be a palette PNG (IHDR colour type 3), decode at its declared size and stay under 100 KiB, or 128 KiB for a maskable icon, and maskable icons must be fully opaque. For the head it checks the exact link list, the three sizes in the ICO directory, that touch icons are opaque, and that the nine copied files match the pack byte for byte. It expects `text/html` for `/icons/icon-1024.png` and the retired root icons (`/favicon-32.png`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-192.png`, `/icon-maskable-512.png`), because the server answers a missing file with the app shell and status 200.

<!-- kk:related:start -->
# Related

- Related: [map-app-icons-script](../../tooling-and-project/repo-and-scripts/map-app-icons-script.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../../tooling-and-project/testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [practice-theme-tokens-data-theme-and-cached-theme](../theme-and-tokens/practice-theme-tokens-data-theme-and-cached-theme.md)
- Related: [map-app-shell-brand-and-navigation](map-app-shell-brand-and-navigation.md)
<!-- kk:related:end -->
