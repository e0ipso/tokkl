---
type: map
title: Brand component and the PNG wordmark image
description: >-
  Brand.tsx renders only the PNG Tokkl wordmark in sm, md and lg sizes; the app
  icon is only the browser and OS icon.
tags:
  - web
  - brand
  - wordmark
kk_schema_version: 3
kk_id: map-brand-component-and-the-png-wordmark-image
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0'
kk_relates_to:
  - map-wordmark-crop-and-its-four-outputs
  - map-npm-run-icons-inputs-and-web-icons
  - map-wordmark-dark-mode-halo-and-its-e2e-checks
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/Brand.tsx` renders only the wordmark, in sizes `sm` (phone header strip), `md` (sidebar) and `lg` (auth pages and the splash), with the width from `WORDMARK_WIDTH` (84, 130 and 260 CSS px) and the height from `WORDMARK_RATIO`, which is `769 / 2059`, the height over width of the crop in `scripts/icons.ts`. The app icon appears only as the browser and OS icon. Show the brand anywhere else through this component. The wordmark is an `<img alt="Tokkl">` with a `srcset` of `/brand/wordmark-260.png` and `wordmark-520.png`, so screen readers still hear the name. `.brand` stays `display: inline-flex` so its box is as tall as the image, with no line-box gap under it; the `brand-${size}` classes have no CSS rules. There is no `Wordmark.tsx` and no SVG; `scripts/icons.ts` makes the images from `docs/brand` (see `map-wordmark-crop-and-its-four-outputs`).

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [map-wordmark-crop-and-its-four-outputs](../../../tooling-and-project/repo-and-scripts/app-icons-script/map-wordmark-crop-and-its-four-outputs.md)
- Related: [map-npm-run-icons-inputs-and-web-icons](../../../tooling-and-project/repo-and-scripts/app-icons-script/map-npm-run-icons-inputs-and-web-icons.md)
- Related: [map-wordmark-dark-mode-halo-and-its-e2e-checks](map-wordmark-dark-mode-halo-and-its-e2e-checks.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0
<!-- kk:citations:end -->
