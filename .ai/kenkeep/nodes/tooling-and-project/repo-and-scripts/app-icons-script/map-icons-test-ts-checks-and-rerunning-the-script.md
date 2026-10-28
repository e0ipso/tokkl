---
type: map
title: icons.test.ts checks and rerunning the script
description: >-
  No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib;
  rerun the script in a temp copy of scripts/ and docs/.
tags:
  - tooling
  - icons
  - maskable
  - wordmark
  - monochrome
kk_schema_version: 3
kk_id: map-icons-test-ts-checks-and-rerunning-the-script
kk_derived_from:
  - 'b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0'
kk_relates_to:
  - map-test-and-static-analysis-layout
  - map-npm-run-icons-inputs-and-web-icons
  - map-wordmark-crop-and-its-four-outputs
  - map-desktop-colour-and-monochrome-icons
kk_depends_on: []
kk_confidence: high
---
No committed test runs the script. Importing `icons.ts` runs `magick` and writes into the checkout, CI's test job installs no ImageMagick, and only the same ImageMagick build reproduces the committed bytes (7.1.1-43 does). `scripts/icons.test.ts`, part of `npm test`, decodes the committed PNGs in plain Node with `node:zlib` instead. For the wordmark it checks that the master's alpha bounds plus 4 px give `tokkl-wordmark-full.png`, that `WORDMARK_RATIO` equals that file's ratio and the 260, 520 and 640 files keep it, and that all four are 8-bit palette PNGs with only `IHDR`, `PLTE`, `tRNS`, `IDAT` and `IEND` chunks. It reads `WORDMARK_RATIO` with a regex, so keep the line as `const WORDMARK_RATIO = <height> / <width>;`. For the desktop icons it checks that the iconset holds exactly the ten `iconutil` names and the KDE `icons/` directory exactly its six sizes, that every KDE, GNOME and macOS icon is an 8-bit RGBA PNG of its size with only `IHDR`, `IDAT` and `IEND` chunks whose art's alpha-weighted centre is within 0.5 px of `LOGO`'s and whose share of the canvas is within 10% of it (`MAX_CENTRE_SHIFT`, `MAX_COVERAGE_CHANGE`), and that `tokkl-96.png` is a byte copy of `tokkl.png`. The favicons and `icon-192`/`icon-512` must have transparent corners, some fully opaque pixels and the same placement. Each monochrome logo must match its colour counterpart's size, be an RGBA PNG in a single ink, sit within 0.5 px of the pack outline's centre and cover 2 to 5 times the pack outline's share of the canvas (a filled silhouette covers about 6.6 times). For each maskable icon it checks that the pack file at the same path has the same dimensions and a mean RGBA channel error of at most 2 of 255 (`MAX_MEAN_CHANNEL_ERROR`), and that the served file is an 8-bit, non-interlaced palette PNG of at most 256 colours with no chunks beyond those five. `magick compare -metric MAE <pack file> <served file> null:` puts the committed maskables at 0.36 to 0.64 of 255 (it prints the figure normalised to 0 to 1 in brackets) and a different pack icon of the same size (`icon-512.png` against `maskable-512.png`) at about 13, which is the case the bound catches. The script resolves its paths from its own location, so to rerun it without touching the checkout, copy `scripts/icons.ts` and `docs/` into a temporary directory with empty `desktop/kde/package/contents/images/` and `desktop/gnome/extension/` directories (the script creates the web `brand/` and `icons/` directories, the KDE `icons/` directory and the macOS iconset, with their parents, but not those two) and run it there.

<!-- Verified against the current code on 2026-10-28. -->

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](../../testing/map-test-and-static-analysis-layout.md)
- Related: [map-npm-run-icons-inputs-and-web-icons](map-npm-run-icons-inputs-and-web-icons.md)
- Related: [map-wordmark-crop-and-its-four-outputs](map-wordmark-crop-and-its-four-outputs.md)
- Related: [map-desktop-colour-and-monochrome-icons](map-desktop-colour-and-monochrome-icons.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0
<!-- kk:citations:end -->
