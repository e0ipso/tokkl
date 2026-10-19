# Brand assets

This directory holds Tokkl's brand artwork. `npm run icons` reads some of it and writes the served icons under `packages/web/public` (it needs ImageMagick 7).

## Wordmark

- `tokkl-wordmark-v3.png` is the wordmark source.
- `tokkl-wordmark.png` is a 640 px crop of it. It is the header image of the top-level `README.md`.
- `tokkl-wordmark-1645.png` is the crop at full width. Clients that need the wordmark larger than 640 px should scale this file down.

`npm run icons` writes both crops from the source. See `scripts/icons.ts`.

## Wordmark pack

`wordmark-pack/` is the clock O wordmark pack, in which the clock replaces the letter "o". Its own `wordmark-pack/README.md` has the details.

- `wordmark-pack/source/tokkl-wordmark-clock-master.png` is the pack's raster master. It will be the source of every served wordmark. Until `npm run icons` switches to it, `tokkl-wordmark-v3.png` is still the input.
- `wordmark-pack/svg/tokkl-wordmark-detailed.svg` is the editable master and `wordmark-pack/pdf/tokkl-wordmark-detailed.pdf` is the print master. `wordmark-pack/png/` has the detailed wordmark at 640, 1280 and 2560 px.
- The pack's clean and mono variants (SVG, PDF and PNG) and its `previews/` are left out on purpose, even though the pack's own README recommends the clean SVG for web use.
- The Android app takes the master from here.

## Icon pack

`icon-pack/` is the clock icon pack. Its own `icon-pack/README.md` has the integration details. Each kind of client takes one subdirectory:

| Client | Take | Notes |
| --- | --- | --- |
| Browsers and installed web apps | `icon-pack/web/public` | Favicon, `any` and maskable PNGs, Apple touch icons and a web app manifest. `icon-pack/web/head-snippet.html` has the tags for the document `<head>`. |
| Android launcher | `icon-pack/android/res` | Merged into the app module's `src/main/res`. It holds the adaptive icon definitions (`mipmap-anydpi-v26`, and `mipmap-anydpi-v33` with a monochrome layer for themed icons), the foreground and monochrome layers and the legacy launcher PNGs at mdpi through xxxhdpi, and the background colour in `values`. The Android app copies this directory from here. |
| Store listings | `icon-pack/store/google-play-512.png` | The 512 px Google Play listing icon. It is separate from the launcher resources. |

The rest of the pack is `source/` (the master artwork the exports come from), `previews/`, `scripts/build.mjs`, and `checks.json`, `inventory.json` and `validation-report.json`, which record the geometry checks and the size and SHA-256 of every file.

### Rebuild

```sh
node docs/brand/icon-pack/scripts/build.mjs
```

This needs Node.js 18 or newer and ImageMagick 7 with `magick` on `PATH`. The script rewrites the pack's exports, previews and `inventory.json` in place.

## Served icon inputs

These files are the inputs that `npm run icons` copies or resizes into `packages/web/public`:

- `tokkl-icon-v4-192.png`, `tokkl-icon-v4-512.png` and `tokkl-icon-v4-1024.png`
- `tokkl-favicon-v4-32.png`
- `icon-maskable-192.png` and `icon-maskable-512.png`
- `apple-touch-icon.png`

`tokkl-logo-v4.png` is an icon image that no script or source file reads.
