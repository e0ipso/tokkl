---
type: map
title: Wordmark crop and its four outputs
description: >-
  WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and
  README; WORDMARK_RATIO tracks the crop.
tags:
  - wordmark
  - web
  - icons
  - imagemagick
kk_schema_version: 3
kk_id: map-wordmark-crop-and-its-four-outputs
kk_derived_from:
  - 'b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0'
kk_relates_to:
  - map-app-shell-brand-and-navigation
  - map-readme-screenshots-script
  - map-icons-test-ts-checks-and-rerunning-the-script
kk_depends_on: []
kk_confidence: high
---
`Brand.tsx` shows only the wordmark, so there is no served brand icon. The master's art touches its top and bottom edges, so `WORDMARK_CROP` (`-trim +repage -bordercolor none -border 4`) trims it to its alpha bounds (2051x761+16+0) and adds a 4 px transparent border, which makes the crop 2059x769. From that crop the script writes `brand/wordmark-260.png` (260x97) and `brand/wordmark-520.png` (520x194) for the `srcset`, the 640x239 `docs/brand/tokkl-wordmark.png` used as the README header, and `docs/brand/tokkl-wordmark-full.png` at the full crop size, for clients that need the wordmark wider than 640 px. All four are 256-colour palette PNGs with a `tRNS` chunk. `WORDMARK_RATIO` in `Brand.tsx` is the crop's height over width, `769 / 2059`; change it whenever the crop or the master changes.

Palette reduction drops the master's faintest edge pixels (its top row is at most 4/255 opaque). The visible art in `tokkl-wordmark-full.png` therefore sits 9 px from the top, 6 from the left and 4 from the right and bottom, while the canvas still matches the crop. Measure the crop on the master, not on an output.

<!-- Verified against the current code on 2026-10-28. -->

<!-- kk:related:start -->
# Related

- Related: [map-app-shell-brand-and-navigation → map-brand-component-and-the-png-wordmark-image](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-brand-component-and-the-png-wordmark-image.md)
- Related: [map-app-shell-brand-and-navigation → map-lazy-page-chunks-and-failed-load-recovery](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-lazy-page-chunks-and-failed-load-recovery.md)
- Related: [map-app-shell-brand-and-navigation → map-nav-list-phone-more-sheet-and-nav-running-dots](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-nav-list-phone-more-sheet-and-nav-running-dots.md)
- Related: [map-app-shell-brand-and-navigation → map-phone-e2e-navigation-helpers-tapnav-and-openmore](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-phone-e2e-navigation-helpers-tapnav-and-openmore.md)
- Related: [map-app-shell-brand-and-navigation → map-wordmark-dark-mode-halo-and-its-e2e-checks](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-wordmark-dark-mode-halo-and-its-e2e-checks.md)
- Related: [map-readme-screenshots-script](../map-readme-screenshots-script.md)
- Related: [map-icons-test-ts-checks-and-rerunning-the-script](map-icons-test-ts-checks-and-rerunning-the-script.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0
<!-- kk:citations:end -->
