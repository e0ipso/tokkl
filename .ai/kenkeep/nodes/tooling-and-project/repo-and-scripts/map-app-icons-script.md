---
type: map
title: 'Brand images: npm run icons derives every served file from docs/brand'
description: >-
  scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7
  into the served icons and wordmark, and copies the maskable and apple-touch icons as supplied.
tags:
  - tooling
  - pwa
  - icons
  - imagemagick
  - maskable
  - web
kk_schema_version: 3
kk_id: map-app-icons-script
kk_derived_from: []
kk_relates_to:
  - map-readme-screenshots-script
  - practice-playwright-gotchas-in-the-e2e-specs
kk_depends_on: []
kk_confidence: high
---
The owner's raster artwork sits in `docs/brand` (`tokkl-wordmark-v3.png`, `tokkl-icon-v4-1024.png`, `-512.png`, `-192.png` and `tokkl-favicon-v4-32.png`), plus the owner's finished mobile exports `icon-maskable-192.png`, `icon-maskable-512.png` and `apple-touch-icon.png`. Those files are sources only; the server does not ship them. `npm run icons` (`scripts/icons.ts`) derives every served image from them with ImageMagick 7 (`magick`, which must be on `PATH`; the script exits with a message when it is missing). Outputs carry no metadata or timestamps, so the same ImageMagick build writes identical files on every run. After replacing a file in `docs/brand`, run the script and commit the outputs with it.

Outputs in `packages/web/public`: `favicon-32.png` and `icon-192.png` are copies of the owner's files; `icon-512.png` is the 512 source quantised to 256 colours; `icon-maskable-192.png`, `icon-maskable-512.png` and the 180px `apple-touch-icon.png` are byte-identical copies of the owner's exports, not quantised or recomposited. They are opaque, on navy `#01013A`, which is what iOS needs (it paints transparent corners black) and what Android needs for a maskable icon. The maskable pair keeps its artwork inside a centred circle of radius 38% of the width, so a launcher mask does not clip it. To change them, replace the file in `docs/brand` and run the script; do not redraw them in the script. `brand/icon-96.png` is the 96px icon `Brand.tsx` shows; `brand/wordmark-260.png` and `brand/wordmark-520.png` are the wordmark cropped to `1645x709+80+91` (the lettering without the transparent margin) and resized for the `srcset`. The same crop also writes the 640px `docs/brand/tokkl-wordmark.png` used as the README header. Served files are 2.5 to 113 KB. `e2e/pwa.spec.ts` fails any manifest icon over 100 KB, except the maskable ones, which get 128 KB because `icon-maskable-512.png` is about 112 KB and loads only when the app is installed.

The manifest keeps `icon-192.png` and `icon-512.png` as general-purpose icons and adds the two maskable files with `"purpose": "maskable"`. The general-purpose icons stay separate because their artwork does not fit the safe zone. `e2e/pwa.spec.ts` expects all four entries, checks that the maskable ones are fully opaque and decode at their declared sizes. There is no `icon.svg`. `index.html` links `favicon-32.png` and `apple-touch-icon.png`. If you change `WORDMARK_CROP`, change `WORDMARK_RATIO` in `Brand.tsx` with it.

<!-- kk:related:start -->
# Related

- Related: [map-readme-screenshots-script](map-readme-screenshots-script.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
<!-- kk:related:end -->
