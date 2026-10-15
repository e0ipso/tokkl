---
type: practice
title: Display font is the bundled Anybody; one reduced-motion block ends styles.css
description: >-
  Anybody ships from packages/web/public/fonts with declared axis ranges and a
  crossorigin preload. One reduced-motion block ends styles.css.
tags:
  - web
  - css
  - fonts
  - motion
  - accessibility
kk_schema_version: 3
kk_id: practice-display-font-and-reduced-motion
kk_derived_from: []
kk_relates_to:
  - practice-contrast-tables-and-project-colours
kk_depends_on: []
kk_confidence: high
---
The display face is Anybody (SIL OFL 1.1), one variable file at `packages/web/public/fonts/anybody-wdth-wght.woff2` with its licence in `OFL.txt`. It is used through `--font-display`; body text, controls and tables use the system stack in `--font-body`.

- The file's default instance is width 50, weight 100 (UltraCondensed Thin). The `@font-face` in `packages/web/src/styles.css` therefore declares `font-weight: 100 900` and `font-stretch: 50% 150%` to match the axes. Keep both ranges.
- The preload in `packages/web/index.html` needs `crossorigin`. Fonts are fetched in CORS mode, so a preload without it is not reused and the font downloads twice.
- No CDN fonts or other outside assets: the CSP in `packages/api/src/app.ts` has `font-src 'self'`, and `docs/PRD.md` (Visual direction, "No outbound assets") forbids them.

The only `prefers-reduced-motion` query in `packages/web/src` is the last rule in `packages/web/src/styles.css`. It sets `--duration-fast` and `--duration-base` to 0ms and forces every animation and transition to 0.01ms with `!important`, which is needed to beat class selectors such as `.running-dot`. New rules use the `--duration-*` tokens and add no reduced-motion query of their own.

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
<!-- kk:related:end -->
