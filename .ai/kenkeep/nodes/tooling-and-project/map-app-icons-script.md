---
type: map
title: 'Brand images: npm run icons derives every served file from docs/brand'
description: >-
  scripts/icons.ts resizes the owner's PNG artwork in docs/brand with ImageMagick 7
  into the served icons, apple-touch icon and wordmark.
tags:
  - tooling
  - pwa
  - icons
  - imagemagick
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
The owner's raster artwork sits in `docs/brand` (`tokkl-wordmark-v3.png`, `tokkl-icon-v4-1024.png`, `-512.png`, `-192.png` and `tokkl-favicon-v4-32.png`). Those files are sources only; the server does not ship them. `npm run icons` (`scripts/icons.ts`) derives every served image from them with ImageMagick 7 (`magick`, which must be on `PATH`; the script exits with a message when it is missing). Outputs carry no metadata or timestamps, so the same ImageMagick build writes identical files on every run. After replacing a file in `docs/brand`, run the script and commit the outputs with it.

Outputs in `packages/web/public`: `favicon-32.png` and `icon-192.png` are copies of the owner's files; `icon-512.png` is the 512 source quantised to 256 colours; `apple-touch-icon.png` is the 1024 icon at 156px centred on a 180px square filled with `#f4e7cf` (the light `--bg`), because iOS paints transparent corners black; `brand/icon-96.png` is the 96px icon `Brand.tsx` shows; `brand/wordmark-260.png` and `brand/wordmark-520.png` are the wordmark cropped to `1645x709+80+91` (the lettering without the transparent margin) and resized for the `srcset`. The same crop also writes the 640px `docs/brand/tokkl-wordmark.png` used as the README header. Served files are 2.5 to 64 KB, and `e2e/pwa.spec.ts` fails any manifest icon over 100 KB.

The manifest lists only `icon-192.png` and `icon-512.png`, with no `maskable` purpose, because the artwork does not fit the safe zone. There is no `icon.svg`. `index.html` links `favicon-32.png` and `apple-touch-icon.png`. If you change `WORDMARK_CROP`, change `WORDMARK_RATIO` in `Brand.tsx` with it.

<!-- kk:related:start -->
# Related

- Related: [map-readme-screenshots-script](map-readme-screenshots-script.md)
- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
