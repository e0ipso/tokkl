---
type: map
title: 'Brand images: npm run icons derives every served file from docs/brand'
description: >-
  icons.ts copies or quantises the web icons, renders the KDE, GNOME and macOS
  icons from the master, crops the wordmark; no test reruns it.
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
  - map-pwa-manifest-and-head-icon-links
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
kk_depends_on: []
kk_confidence: high
---
`npm run icons` (`scripts/icons.ts`) derives every served brand image with ImageMagick 7 (`magick`, which must be on `PATH`; the script exits with a message when it is missing). It reads two packs in `docs/brand` in place. The icons come from `docs/brand/icon-pack/web/public` (`ICON_PACK` in the script), and each lands at the same relative path under `packages/web/public`. The wordmark comes from the wordmark pack's raster master, `docs/brand/wordmark-pack/source/tokkl-wordmark-clock-master.png` (2067x761, with the clock in place of the "o"). The server ships neither pack. Outputs carry no metadata or timestamps, so the same ImageMagick build writes identical files on every run. When the owner supplies a new pack, run the script and commit the outputs with it; the packs themselves never change in the checkout (see [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)).

The favicons and Apple touch icons are small, so `copiedIcons` copies nine of them byte for byte: `favicon.ico` (16, 32 and 48 px), the root `apple-touch-icon.png` (180 px), and under `icons/` the 16, 32 and 48 px `favicon-<n>.png` files and the 120, 152, 167 and 180 px `apple-touch-icon-<n>.png` files. The five manifest icons in `quantisedIcons` (`icons/icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png` and `maskable-1024.png`) go through `-dither None -colors 256` and are written as `png8:`, an 8-bit palette PNG. As supplied, the 512 and 1024 px files are over the budgets in `e2e/pwa.spec.ts`, which allows 100 KiB per icon and 128 KiB per maskable manifest icon. With ImageMagick 7.1.1-43 the five come out at about 11, 55, 8, 39 and 125 KiB. `maskable-1024.png` (127670 bytes) is only 3.3 KiB under its budget, so a new pack can push it over. The pack's `icons/icon-1024.png` is not served: quantised, it is 176988 bytes, over the 100 KiB budget for a general-purpose icon. The script only resizes or quantises; the safe zone, the opaque `#291329` background and the artwork are the pack's, so do not redraw or recomposite them in the script.

`Brand.tsx` shows only the wordmark, so there is no served brand icon. The master's art touches its top and bottom edges, so `WORDMARK_CROP` (`-trim +repage -bordercolor none -border 4`) trims it to its alpha bounds (2051x761+16+0) and adds a 4 px transparent border, which makes the crop 2059x769. From that crop the script writes `brand/wordmark-260.png` (260x97) and `brand/wordmark-520.png` (520x194) for the `srcset`, the 640x239 `docs/brand/tokkl-wordmark.png` used as the README header, and `docs/brand/tokkl-wordmark-full.png` at the full crop size, for clients that need the wordmark wider than 640 px. All four are 256-colour palette PNGs with a `tRNS` chunk. `WORDMARK_RATIO` in `Brand.tsx` is the crop's height over width, `769 / 2059`; change it whenever the crop or the master changes.

Palette reduction drops the master's faintest edge pixels (its top row is at most 4/255 opaque). The visible art in `tokkl-wordmark-full.png` therefore sits 9 px from the top, 6 from the left and 4 from the right and bottom, while the canvas still matches the crop. Measure the crop on the master, not on an output.

The KDE widget's icons come from the icon pack's master, `docs/brand/icon-pack/source/master-export.png` (`MASTER`). `MASTER_SQUARE` trims it to its alpha bounds and centres it on a transparent square as tall as the art, and the script writes full-colour RGBA PNGs (`png32:`): `desktop/kde/package/contents/images/tokkl.png` (96 px, the panel logo) and `desktop/kde/package/icons/tokkl-<n>.png` for 32, 48, 64, 96, 128 and 256 px. `tokkl-96.png` is a byte copy of `tokkl.png`, and both `desktop/kde/autotests/smokeloadtest.cpp` and `desktop/kde/scripts/check-package.sh` require them to match. `desktop/kde/package/CMakeLists.txt` installs each size as `hicolor/<n>x<n>/apps/<plasmoid id>.png` for the widget picker, which finds it through `KPlugin.Icon`; `icons/` stays out of the widget package, which copies only `contents/`.

The same `MASTER_SQUARE` rule renders the other desktop icons as `png32:` files. The GNOME extension's top-bar logo is `desktop/gnome/extension/tokkl.png` at 32 px (drawn at the 16 px panel size, so it stays sharp at twice that). The macOS bundle icon is `desktop/macos/resources/Tokkl.iconset/`: `icon_<n>x<n>.png` and `icon_<n>x<n>@2x.png` for 16, 32, 128, 256 and 512 points, the ten names `iconutil -c icns` expects (see `map-macos-menu-bar-app`). They are full-colour images of the logo, not template images. The 16 pt pair (`icon_16x16.png` and `icon_16x16@2x.png`) is also compiled into the `tokklmacos` library as the menu bar item's logo, so re-rendering the iconset changes the status item too. The script writes no separate file for it. The client table in `docs/brand/README.md` has one row per client and the pack file it takes, KDE, GNOME and macOS included; a new client output gets a row there.

Do not test which file the icon theme draws for a size. hicolor's `256x256/apps` directory is `Type=Scalable` with `MinSize=64`, so the theme may draw any size from 64 px up from the 256 px file, and a lookup for 96 px can come back drawn from `tokkl-256.png`. The smokeload test therefore compares the 96 px files byte for byte and checks that `QIcon::fromTheme` lists all six sizes. The widget picker and the panel after a plasmashell restart are checked by hand.

No committed test runs the script. Importing `icons.ts` runs `magick` and writes into the checkout, CI's test job installs no ImageMagick, and only the same ImageMagick build reproduces the committed bytes (7.1.1-43 does). `scripts/icons.test.ts`, part of `npm test`, decodes the committed PNGs in plain Node with `node:zlib` instead. For the wordmark it checks that the master's alpha bounds plus 4 px give `tokkl-wordmark-full.png`, that `WORDMARK_RATIO` equals that file's ratio and the 260, 520 and 640 files keep it, and that all four are 8-bit palette PNGs with only `IHDR`, `PLTE`, `tRNS`, `IDAT` and `IEND` chunks. It reads `WORDMARK_RATIO` with a regex, so keep the line as `const WORDMARK_RATIO = <height> / <width>;`. For the desktop icons it checks that the iconset holds exactly the ten `iconutil` names and the KDE `icons/` directory exactly its six sizes, that every KDE, GNOME and macOS icon is an 8-bit RGBA PNG of its size with only `IHDR`, `IDAT` and `IEND` chunks whose art fills the height and is centred across, and that `tokkl-96.png` is a byte copy of `tokkl.png`. For each manifest icon it checks that the pack file at the same path has the same dimensions and a mean RGBA channel error of at most 2 of 255 (`MAX_MEAN_CHANNEL_ERROR`), and that the served file is an 8-bit, non-interlaced palette PNG of at most 256 colours with no chunks beyond those five. `magick compare -metric MAE <pack file> <served file> null:` puts the committed icons at 0.37 to 0.86 of 255 (it prints the figure normalised to 0 to 1 in brackets) and a different pack icon of the same size at about 25, which is the case the bound catches. The script resolves its paths from its own location, so to rerun it without touching the checkout, copy `scripts/icons.ts` and `docs/` into a temporary directory with empty `desktop/kde/package/contents/images/` and `desktop/gnome/extension/` directories (the script creates the web `brand/` and `icons/` directories, the KDE `icons/` directory and the macOS iconset, with their parents, but not those two) and run it there.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [map-readme-screenshots-script](map-readme-screenshots-script.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)
- Related: [map-app-shell-brand-and-navigation](../../web-ui-styling-and-layout/map-app-shell-brand-and-navigation.md)
- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
- Related: [map-pwa-manifest-and-head-icon-links](../../web-ui-styling-and-layout/map-pwa-manifest-and-head-icon-links.md)
- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../kde-companion/plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
<!-- kk:related:end -->
