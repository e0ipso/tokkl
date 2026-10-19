# Tokkl wordmark with clock O

The clock replaces the second letter in **tokkl**. The tilted letters, paint drips, navy outline and rainbow palette follow the existing wordmark.

## Choose a version

| Version | Use | Artwork |
| --- | --- | --- |
| `tokkl-wordmark-detailed` | Large branding, splash screens, posters | 96-color vector trace with paint texture and gloss. Local gradient underlays prevent gaps between small traced fragments. |
| `tokkl-wordmark-clean` | Website headers, app navigation, everyday branding | Smooth cubic paths, gradients and major highlights. Most paint texture is removed. |
| `tokkl-wordmark-mono-dark` | One-color artwork on light backgrounds | Black single-ink shapes with an open clock counter and separate hands. |
| `tokkl-wordmark-mono-white` | Reversed artwork on dark backgrounds | White version of the same single-ink shapes. |

All four versions are in `svg/` and `pdf/`. Transparent PNGs at 640, 1280 and 2560 pixels wide are in `png/`. The PNGs are rendered from the SVG artwork.

`previews/contact-sheet.png` shows the variants on light and dark backgrounds. Background colors in that sheet are for preview only.

## Web and app use

Use the clean SVG by default. SVGs contain editable paths and gradients, with no fonts, embedded raster images, scripts or external assets. Their shared `viewBox` includes 24 source units of transparent margin on every side.

```html
<img
  src="/brand/tokkl-wordmark-clean.svg"
  width="260"
  height="99"
  alt="Tokkl"
  style="height: auto; max-width: 100%;"
>
```

Keep the aspect ratio. For inline SVG, keep IDs unique if inserting more than one wordmark into the same document, since gradient and clipping IDs are document-wide. An external `<img>` isolates these IDs.

For native app views that do not accept SVG directly, use a PNG at the required display density or import the SVG through your platform's vector tooling. These horizontal wordmarks are brand assets. Continue using the separate clock icon pack for Android launchers, PWA icons and Apple touch icons.

Use the detailed version where its texture remains visible. Use the clean or monochrome version at smaller display sizes, and check the clock hands at the actual size. At icon scale, use the standalone clock mark.

## Design and print

SVG is the editable master format. PDFs contain vector paths and gradient shadings with no raster image objects. Their page width is 10 inches; the artwork can be scaled without adding pixels.

The color artwork uses RGB working colors. For commercial printing, have the printer prepare their required CMYK or spot-color separation. The white version is white vector artwork on a transparent page, not a defined white-ink spot plate. Some PDF viewers show it as an apparently blank white page.

The detailed trace approximates the raster's color and texture. The clean version deliberately simplifies them. The raster reference in `source/tokkl-wordmark-clock-master.png` preserves the edited painted artwork.

## Rebuild

The source tooling uses palette quantization and subpixel contour tracing for the detailed version, and smoothed cubic contours for the clean and single-ink versions. PDF export writes those same paths and gradients directly.

From the unpacked pack folder, install dependencies in your preferred environment:

```sh
python3 -m pip install -r source/requirements.txt
npm install --no-save sharp
sh source/rebuild.sh
```

PNG export uses sharp/libvips/librsvg to preserve gradients and clipping. The build scripts accept `TOKKL_PACK_DIR`; the PNG script also accepts `TOKKL_SHARP_MODULE` if sharp is installed at a custom module path.

`validation-report.json` records independent asset checks. Proof renders were inspected for letter shapes, clock geometry, transparency, margins and light/dark background use.
