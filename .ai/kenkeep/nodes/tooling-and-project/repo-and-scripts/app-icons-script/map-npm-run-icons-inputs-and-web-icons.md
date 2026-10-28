---
type: map
title: npm run icons inputs and web icons
description: >-
  icons.ts reads the docs/brand packs with magick; copies touch icons, resizes
  LOGO, quantises maskables under the pwa.spec budgets.
tags:
  - tooling
  - pwa
  - icons
  - imagemagick
  - maskable
kk_schema_version: 3
kk_id: map-npm-run-icons-inputs-and-web-icons
kk_derived_from:
  - 'b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0'
kk_relates_to:
  - map-pwa-manifest-and-head-icon-links
  - practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them
  - practice-playwright-gotchas-in-the-e2e-specs
  - map-readme-screenshots-script
  - map-icons-test-ts-checks-and-rerunning-the-script
kk_depends_on: []
kk_confidence: high
---
`npm run icons` (`scripts/icons.ts`) derives every served brand image with ImageMagick 7 (`magick`, which must be on `PATH`; the script exits with a message when it is missing). It reads two packs in `docs/brand` in place. The web icons come from two places in the icon pack: the opaque touch and maskable exports in `docs/brand/icon-pack/web/public` (`ICON_PACK` in the script), and the transparent logo `docs/brand/icon-pack/logo/color-1024.png` (`LOGO`). Each lands at the same relative path under `packages/web/public`. The wordmark comes from the wordmark pack's raster master, `docs/brand/wordmark-pack/source/tokkl-wordmark-clock-master.png` (2067x761, with the clock in place of the "o"). The server ships neither pack. Outputs carry no metadata or timestamps, so the same ImageMagick build writes identical files on every run. When the owner supplies a new pack, run the script and commit the outputs with it; the packs themselves never change in the checkout (see [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](../practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)).

The Apple touch icons are opaque, so `copiedIcons` copies five of them byte for byte: the root `apple-touch-icon.png` (180 px) and the 120, 152, 167 and 180 px `icons/apple-touch-icon-<n>.png` files. The favicons and general-purpose icons keep the logo's transparent background: the script resizes `LOGO` to 16, 32 and 48 px (`icons/favicon-<n>.png`) and to 192 and 512 px (`icons/icon-<n>.png`), writes them undithered at 256 colours as `png8:`, and packs the three favicons into `favicon.ico`. The three maskable manifest icons in `quantisedIcons` (`icons/maskable-192.png`, `maskable-512.png` and `maskable-1024.png`) are the pack's files put through `-dither None -colors 256` and written as `png8:`, an 8-bit palette PNG. As supplied, the 512 and 1024 px maskables are over the budgets in `e2e/pwa.spec.ts`, which allows 100 KiB per icon and 128 KiB per maskable manifest icon. With ImageMagick 7.1.1-43, `icon-192`, `icon-512` and the three maskables come out at about 8, 42, 7, 37 and 120 KiB. `maskable-1024.png` (123231 bytes) is only about 5 KiB under its budget, so a new pack can push it over. The pack's `icons/icon-1024.png` is not served: even quantised, it stays over the 100 KiB budget for a general-purpose icon. The script only resizes or quantises; the safe zone, the opaque `#291329` background and the artwork are the pack's, so do not redraw or recomposite them in the script.

<!-- Verified against the current code on 2026-10-28. -->

<!-- kk:related:start -->
# Related

- Related: [map-pwa-manifest-and-head-icon-links](../../../web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md)
- Related: [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](../practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [map-readme-screenshots-script](../map-readme-screenshots-script.md)
- Related: [map-icons-test-ts-checks-and-rerunning-the-script](map-icons-test-ts-checks-and-rerunning-the-script.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0
<!-- kk:citations:end -->
