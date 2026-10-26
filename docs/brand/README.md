# Brand assets

This directory holds Tokkl's brand artwork. `npm run icons` reads some of it and writes the served icons under `packages/web/public`, the KDE widget's icons under `desktop/kde/package`, the GNOME extension's top bar logo `desktop/gnome/extension/tokkl.png` and the macOS app's iconset under `desktop/macos/resources` (it needs ImageMagick 7).

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
| KDE Plasma widget | `icon-pack/logo/color-1024.png`, `icon-pack/logo/outline-black-1024.png` and `outline-white-1024.png` | `npm run icons` resizes the colour logo into the panel logo and the hicolor widget picker icons, and the outlines into the black and white monochrome panel logos. `desktop/kde/README.md` lists the files. |
| GNOME Shell extension | `icon-pack/logo/color-1024.png` and `icon-pack/logo/outline-black-1024.png` | `npm run icons` writes `desktop/gnome/extension/tokkl.png`, a 32 px full-colour PNG that the top bar button shows before the project indicator, and the symbolic logo `tokkl-symbolic.symbolic.png` from the outline. The extension zip carries both. |
| macOS app bundle | `icon-pack/logo/color-1024.png` and `icon-pack/logo/outline-black-1024.png` | `npm run icons` writes the ten PNGs of `desktop/macos/resources/Tokkl.iconset`, 16 to 1024 px, and the monochrome menu bar logo `desktop/macos/resources/mono_16x16.png` and `mono_16x16@2x.png` from the outline. The macOS build packs the iconset into `Tokkl.icns` with `iconutil`. |

`npm run icons` only resizes the `logo/` files, so every transparent icon keeps the pack's placement. For the monochrome panel logos it also thickens the outline's strokes to 1.5 px at the size the panel draws the logo (16 px on GNOME and macOS, 22 px on KDE).

`logo/` holds the transparent colour logo and the black and white outline logos at 256, 512 and 1024 px; the outlines also come as SVG. The rest of the pack is `source/` (the master artwork and the outline drawing `clock-outline.svg` the exports come from), `previews/`, `scripts/build.mjs` with its `package.json`, and `checks.json`, `inventory.json` and `validation-report.json`, which record the geometry checks and the size and SHA-256 of every file.

### Rebuild

```sh
node docs/brand/icon-pack/scripts/build.mjs
```

This needs Node.js 20.9 or newer, Sharp 0.35.5 (`npm install` in `icon-pack/`) and ImageMagick 7 with `magick` on `PATH`. The script rewrites the pack's exports, previews and `inventory.json` in place.

## Served icon inputs

`npm run icons` derives the web icons from `icon-pack/logo/color-1024.png` and the exports in `icon-pack/web/public`, writing them under `packages/web/public`:

- It derives transparent favicons at 16, 32 and 48 px, a multi-size `favicon.ico`, and transparent general-purpose launcher icons at 192 and 512 px from the pack's colour logo. Opaque maskable icons remain separate.
- It copies the Apple touch icons byte-identical: `apple-touch-icon.png`, `icons/apple-touch-icon-120.png`, `icons/apple-touch-icon-152.png`, `icons/apple-touch-icon-167.png` and `icons/apple-touch-icon-180.png`.
- It writes manifest icons as 256-colour PNGs to stay within the web app's size budgets. The maskable icons come from `icons/maskable-192.png`, `icons/maskable-512.png` and `icons/maskable-1024.png` in the pack.

`icons/icon-1024.png` is not served. It is over the 100 KB budget even quantised.

The web app's manifest follows the pack's `manifest.webmanifest`, but leaves out `icon-1024.png` and keeps the app's own description. `index.html` takes its icon tags from `head-snippet.html` and keeps one theme-color tag per colour scheme instead of the pack's single tag.
