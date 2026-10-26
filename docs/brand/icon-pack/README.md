# Tokkl icon pack

Clock O artwork with the pink paint drip, on the wordmark's dark plum background, `#291329`.

## Centering and standalone logos

The main clock body determines placement. Its center of gravity is the alpha-weighted centroid of source pixels above row 1000, at x=651.038225, y=550.057134 on the 1254px source canvas. The narrow dangling drip below that shoulder is excluded from the centering calculation. The full drip remains in the artwork and in every clipping and safe-area check.

All variants use that same anchor, uniform scale and translation. Android and maskable web icons fit the complete color and outline artwork inside their safe circles. Other exports fit the complete artwork within a centered 84% square, leaving at least about 8% clearspace at every edge. The artwork can be slightly smaller than the previous pack because the drip extends below a centered clock body.

`logo/` contains transparent color PNGs and transparent black and white outline PNGs and SVGs at 256, 512 and 1024px. Use the black outline on light backgrounds and the white outline on dark backgrounds. The outline has a single outer rim, hollow hands and a hollow center pivot. The SVGs contain editable paths and scale without a fixed raster resolution.

## Web app and iOS home screen

Copy the contents of `web/public/` into your app's public assets directory. Add the tags in `web/head-snippet.html` to the document's `<head>`. Merge `manifest.webmanifest` into your existing manifest if you already have one. Keep your app's existing name, routing, ID and other settings where appropriate.

The supplied URLs assume deployment at the origin root. For a subpath such as `/tokkl/`, update the manifest `id`, `start_url`, `scope` and icon `src` values, and every `href` in the head snippet. Preserve an existing deployed app's manifest ID to avoid changing its install identity.

The manifest declares separate `any` and `maskable` PNGs at 192, 512 and 1024 pixels. Maskable exports have a solid background. All visible artwork fits inside the centered circle with diameter 80% of the image, with a target of 76% to leave room for resampling. Do not replace these with the larger `any` artwork.

Apple touch PNGs are opaque squares at 120, 152, 167 and 180 pixels. The 180px default is also at `/apple-touch-icon.png`. iOS applies its own corner mask. Use the supplied square exports without adding rounded corners. These support the web app's Add to Home Screen icon; they are not a native iOS asset catalog.

The favicon contains 16, 32 and 48px images. Individual PNGs are also included. The full clock artwork is preserved, so the paint texture becomes softer at favicon sizes.

These files provide icons and manifest examples. The app still needs its own HTTPS hosting and any service worker, routing or installation behavior it requires.

## Android app

Merge `android/res/` into your application module's `src/main/res/` directory. Set `android:icon="@mipmap/ic_launcher"` on the existing `<application>` element in `AndroidManifest.xml`. The example in `android/AndroidManifest.icon-snippet.xml` shows that attribute. If the app already has `android:roundIcon`, remove that old reference or point it at `@mipmap/ic_launcher` to avoid displaying an unrelated icon.

Use `compileSdk` 33 or newer so the API 33 monochrome adaptive icon definition can compile. This does not require raising your app's `minSdk` to 33.

| Android version | Resource selected |
| --- | --- |
| Before Android 8 / API 26 | Density-specific `mipmap-*/ic_launcher.png` |
| Android 8 through 12L / API 26–32 | `mipmap-anydpi-v26/ic_launcher.xml` |
| Android 13 / API 33 and newer | `mipmap-anydpi-v33/ic_launcher.xml`, with a monochrome layer |

The adaptive icon has a full opaque background and a separate transparent foreground. Each foreground is 108dp square. The artwork is centered and scaled toward a 65.8dp diameter circle, inside Android's 66dp safe circle. The build measures all pixels with nonzero alpha, including the drip and antialiased edges, and rejects any export that crosses the 66dp safe circle. The outside area is available for launcher masking and motion effects. Native Android foregrounds use Triangle resampling to avoid a faint ringing fringe that would otherwise force the clock to become smaller.

Foreground and monochrome layers are supplied at 108, 162, 216, 324 and 432px for mdpi through xxxhdpi. Legacy launcher PNGs are 48, 72, 96, 144 and 192px. Keep these density directory names unchanged.

These foreground images already contain the required padding. Copy the provided XML and PNG resources directly. Do not add another inset or automatic shrink step in an icon generator, which would make the artwork too small.

The monochrome image uses the outline drawing in `source/clock-outline.svg`, exported with white RGB pixels on transparency. Its rim, hands and center pivot are hollow. It shares the color icon's source anchor and transform. Android chooses the final themed colors where the launcher supports themed icons and the user enables them. The previews show example tints.

## Google Play

Upload `store/google-play-512.png` as the listing icon. It is a 512×512, 32-bit sRGB PNG below 1MB. Its corners are square and it has no added exterior drop shadow; Google Play applies its own treatment. This listing asset is separate from the Android launcher resources.

## Preview and verification

Open `previews/contact-sheet.png` for circle, squircle and rounded-square mask simulations, themed outline examples, a web maskable preview, an iOS web icon preview, black and white outlines, and the actual favicon sizes.

For Android previews, the central 72dp viewport is cropped from the 108dp adaptive layer before applying the illustrative mask. This approximates resting launcher presentation. The drawn masks and theme colors are examples, not a guarantee of every device's rendering.

`checks.json` records the source body anchor, each export's affine transform, measured color body-center error, artwork geometry and export checks. Radii include the furthest corner of every pixel with nonzero alpha. `inventory.json` lists file sizes and SHA-256 hashes, excluding itself. No Android app or web project was supplied, so the pack is checked as an asset set; integration still needs a build and device check in the target app.

## Rebuild

Requires Node.js 20.9 or newer, Sharp 0.35.5 and ImageMagick 7 with the `magick` executable on `PATH`. DejaVu Sans is used only for preview labels. Sharp uses librsvg to rasterize the vector outline.

```sh
npm install
npm run build
```

The script resolves paths relative to itself, so `node /path/to/scripts/build.mjs` works from any working directory after dependencies are installed. An existing Sharp installation can be used by setting `TOKKL_SHARP_PATH` to the absolute path of that package directory. The script exports PNGs in sRGB and explicitly includes the PNG sRGB metadata chunk, validates safe-circle geometry, checks opacity and monochrome pixels, generates previews and refreshes the inventory. It uses a temporary directory and cleans it up.

The original source artwork is `source/master-transparent.png`. The build removes near-invisible background residue by setting alpha values at or below 8/255 to zero, then saves `source/master-export.png`. Higher alpha values and the artwork's RGB colors remain unchanged. This prevents faint stray pixels from forcing the visible clock to become too small. The full drip remains present. `checks.json` also reports visible Android bounds using alpha >=128. Final safety checks still count every exported pixel with nonzero alpha.

Keep the original source to reproduce or revise the exports. No generative image service is used during a rebuild. Byte-identical compression can depend on your ImageMagick version.

## Official references

- [Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)
- [Google Play icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)
- [Maskable web app icons](https://web.dev/articles/maskable-icon)
- [Apple web application icon guidance](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [WebKit home screen web app support](https://webkit.org/blog/13878/)
