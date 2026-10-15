---
type: map
title: 'App icons: npm run icons renders the PNGs from icon.svg'
description: >-
  scripts/icons.ts renders icon-192/512.png from public/icon.svg in Playwright
  Chromium; shapes stay in the maskable safe zone, background full-bleed.
tags:
  - tooling
  - pwa
  - icons
  - playwright
  - web
kk_schema_version: 3
kk_id: map-app-icons-script
kk_derived_from: []
kk_relates_to:
  - map-readme-screenshots-script
  - practice-e2e-test-workflow
kk_depends_on: []
kk_confidence: high
---
`packages/web/public/icon.svg` is the source of the app icon. `packages/web/public/icon-192.png` and `icon-512.png` are generated from it by `npm run icons` (`scripts/icons.ts`), which draws the SVG as an `<img>` in Playwright's Chromium and screenshots it on an opaque background. No other image tool is needed, `CHROMIUM_PATH` picks another Chromium binary as for the e2e tests, and the same Chromium build writes byte-identical files. After editing the SVG, run it and commit the PNGs with the SVG.

The manifest lists the SVG and both PNGs, and `index.html` uses `icon-192.png` as the `apple-touch-icon`. When editing the SVG, keep every shape inside the maskable safe zone, a circle of radius 25.6 around the centre of the 64x64 viewBox, and keep the background a full-bleed opaque rect, so the icon has no transparent edges and launchers that crop to a circle or squircle do not cut the artwork. Colours come from the dark-theme tokens in `styles.css`.

<!-- kk:related:start -->
# Related

- Related: [map-readme-screenshots-script](map-readme-screenshots-script.md)
- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
