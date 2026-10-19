---
type: map
title: 'Brand images: npm run icons derives every served file from docs/brand'
description: >-
  scripts/icons.ts makes the served icons from docs/brand and the wordmark from
  the wordmark pack's raster master with ImageMagick 7; no test reruns it.
tags:
  - tooling
  - pwa
  - icons
  - imagemagick
  - maskable
  - wordmark
  - web
kk_schema_version: 3
kk_id: map-app-icons-script
kk_derived_from: []
kk_relates_to:
  - map-readme-screenshots-script
  - practice-playwright-gotchas-in-the-e2e-specs
  - practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them
  - map-app-shell-brand-and-navigation
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`npm run icons` (`scripts/icons.ts`) derives every served image with ImageMagick 7 (`magick`, which must be on `PATH`; the script exits with a message when it is missing). The wordmark source is the wordmark pack's raster master, `docs/brand/wordmark-pack/source/tokkl-wordmark-clock-master.png` (2067x761, with the clock in place of the "o"). The icons still come from the owner's older files in `docs/brand`: `tokkl-icon-v4-512.png`, `tokkl-icon-v4-192.png`, `tokkl-favicon-v4-32.png` and the finished mobile exports `icon-maskable-192.png`, `icon-maskable-512.png` and `apple-touch-icon.png`. The server ships none of these sources. `tokkl-icon-v4-1024.png`, `tokkl-logo-v4.png` and `icon-pack/` sit there too, but no script reads them; see [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md). Outputs carry no metadata or timestamps, so the same ImageMagick build writes identical files on every run. After replacing a source, run the script and commit the outputs with it.

Outputs in `packages/web/public`: `favicon-32.png` and `icon-192.png` are copies of the owner's files; `icon-512.png` is the 512 source quantised to 256 colours; `icon-maskable-192.png`, `icon-maskable-512.png` and the 180px `apple-touch-icon.png` are byte-identical copies of the owner's exports, not quantised or recomposited. They are opaque, on navy `#01013A`, which is what iOS needs (it paints transparent corners black) and what Android needs for a maskable icon. The maskable pair keeps its artwork inside a centred circle of radius 38% of the width, so a launcher mask does not clip it. To change them, replace the file in `docs/brand` and run the script; do not redraw them in the script. Served files are 2.5 to 113 KB. `e2e/pwa.spec.ts` fails any manifest icon over 100 KB, except the maskable ones, which get 128 KB because `icon-maskable-512.png` is about 112 KB and loads only when the app is installed.

`Brand.tsx` shows only the wordmark, so there is no served brand icon. The master's art touches its top and bottom edges, so `WORDMARK_CROP` (`-trim +repage -bordercolor none -border 4`) trims it to its alpha bounds (2051x761+16+0) and adds a 4 px transparent border, which makes the crop 2059x769. From that crop the script writes `brand/wordmark-260.png` (260x97) and `brand/wordmark-520.png` (520x194) for the `srcset`, the 640x239 `docs/brand/tokkl-wordmark.png` used as the README header, and `docs/brand/tokkl-wordmark-full.png` at the full crop size, for clients that need the wordmark wider than 640 px. All four are 256-colour palette PNGs with a `tRNS` chunk. `WORDMARK_RATIO` in `Brand.tsx` is the crop's height over width, `769 / 2059`; change it whenever the crop or the master changes.

Palette reduction drops the master's faintest edge pixels (its top row is at most 4/255 opaque). The visible art in `tokkl-wordmark-full.png` therefore sits 9 px from the top, 6 from the left and 4 from the right and bottom, while the canvas still matches the crop. Measure the crop on the master, not on an output.

The manifest keeps `icon-192.png` and `icon-512.png` as general-purpose icons and adds the two maskable files with `"purpose": "maskable"`. The general-purpose icons stay separate because their artwork does not fit the safe zone. `e2e/pwa.spec.ts` expects all four entries, checks that the maskable ones are fully opaque and decode at their declared sizes. There is no `icon.svg`. `index.html` links `favicon-32.png` and `apple-touch-icon.png`.

No committed test runs the script. Importing `icons.ts` runs `magick` and writes into the checkout, CI's test job installs no ImageMagick, and only the same ImageMagick build reproduces the committed bytes (7.1.1-43 does). `scripts/icons.test.ts`, part of `npm test`, decodes the committed wordmark files in plain Node instead. It checks that the master's alpha bounds plus 4 px give `tokkl-wordmark-full.png`, that `WORDMARK_RATIO` equals that file's ratio and the 260, 520 and 640 files keep it, and that all four are 8-bit palette PNGs with only `IHDR`, `PLTE`, `tRNS`, `IDAT` and `IEND` chunks. It reads `WORDMARK_RATIO` with a regex, so keep the line as `const WORDMARK_RATIO = <height> / <width>;`. The script resolves its paths from its own location, so to rerun it without touching the checkout, copy `scripts/icons.ts` and `docs/` into a temporary directory with an empty `packages/web/public/` and run it there.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [map-readme-screenshots-script](map-readme-screenshots-script.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)
- Related: [map-app-shell-brand-and-navigation](../../web-ui-styling-and-layout/map-app-shell-brand-and-navigation.md)
- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
