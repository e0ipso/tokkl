# Brand assets

This directory holds Tokkl's brand artwork. `npm run icons` reads some of it and writes the served icons under `packages/web/public`, the KDE widget's icons under `desktop/kde/package` and the macOS app's iconset under `desktop/macos/resources` (it needs ImageMagick 7).

## Wordmark

- `wordmark-pack/source/tokkl-wordmark-clock-master.png` is the wordmark source.
- `tokkl-wordmark.png` is a 640 px crop of it. It is the header image of the top-level `README.md`.
- `tokkl-wordmark-full.png` is the crop at full width, 2059x769. Clients that need the wordmark larger than 640 px should scale this file down.

`npm run icons` crops the source to its artwork's alpha bounds plus a 4 px transparent margin, then writes both files and the web app's wordmark images from that crop. See `scripts/icons.ts`.

## Wordmark pack

`wordmark-pack/` is the clock O wordmark pack, in which the clock replaces the letter "o". Its own `wordmark-pack/README.md` has the details.

- `wordmark-pack/source/tokkl-wordmark-clock-master.png` is the pack's raster master and the source of every served wordmark.
- `wordmark-pack/svg/tokkl-wordmark-detailed.svg` is the editable master and `wordmark-pack/pdf/tokkl-wordmark-detailed.pdf` is the print master. `wordmark-pack/png/` has the detailed wordmark at 640, 1280 and 2560 px.
- The pack's clean and mono variants (SVG, PDF and PNG) and its `previews/` are left out on purpose, even though the pack's own README recommends the clean SVG for web use.
- The Android app takes the master from here.

## Icon pack

`icon-pack/` is the clock icon pack. Its own `icon-pack/README.md` has the integration details. Each kind of client takes one part of it:

| Client | Take | Notes |
| --- | --- | --- |
| Browsers and installed web apps | `icon-pack/web/public` | Favicon, `any` and maskable PNGs, Apple touch icons and a web app manifest. `icon-pack/web/head-snippet.html` has the tags for the document `<head>`. |
| Android launcher | `icon-pack/android/res` | Merged into the app module's `src/main/res`. It holds the adaptive icon definitions (`mipmap-anydpi-v26`, and `mipmap-anydpi-v33` with a monochrome layer for themed icons), the foreground and monochrome layers and the legacy launcher PNGs at mdpi through xxxhdpi, and the background colour in `values`. The Android app copies this directory from here. |
| Store listings | `icon-pack/store/google-play-512.png` | The 512 px Google Play listing icon. It is separate from the launcher resources. |
| KDE Plasma widget | `icon-pack/source/master-export.png` | `npm run icons` trims the artwork to its alpha bounds, centres it on a square transparent canvas and writes the panel logo and the hicolor widget picker icons. `desktop/kde/README.md` lists the files. |
| macOS app bundle | `icon-pack/source/master-export.png` | `npm run icons` trims and centres it as for KDE and writes the ten PNGs of `desktop/macos/resources/Tokkl.iconset`, 16 to 1024 px. The macOS build packs them into `Tokkl.icns` with `iconutil`. |

The rest of the pack is `source/` (the master artwork the exports come from), `previews/`, `scripts/build.mjs`, and `checks.json`, `inventory.json` and `validation-report.json`, which record the geometry checks and the size and SHA-256 of every file.

### Rebuild

```sh
node docs/brand/icon-pack/scripts/build.mjs
```

This needs Node.js 18 or newer and ImageMagick 7 with `magick` on `PATH`. The script rewrites the pack's exports, previews and `inventory.json` in place.

## Served icon inputs

`icon-pack/web/public` is the only source of the icons the web app serves. `npm run icons` writes each file to the same path under `packages/web/public`:

- It copies the favicons and Apple touch icons byte-identical: `favicon.ico`, `apple-touch-icon.png`, `icons/favicon-16.png`, `icons/favicon-32.png`, `icons/favicon-48.png`, `icons/apple-touch-icon-120.png`, `icons/apple-touch-icon-152.png`, `icons/apple-touch-icon-167.png` and `icons/apple-touch-icon-180.png`.
- It quantises the manifest icons to 256 colours, because as supplied the larger ones exceed the web app's size budgets for icons: `icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-192.png`, `icons/maskable-512.png` and `icons/maskable-1024.png`.

`icons/icon-1024.png` is not served. Quantised, it is still about 173 KB, over the 100 KB budget.

The web app's manifest follows the pack's `manifest.webmanifest`, but leaves out `icon-1024.png` and keeps the app's own description. `index.html` takes its icon tags from `head-snippet.html` and keeps one theme-color tag per colour scheme instead of the pack's single tag.
