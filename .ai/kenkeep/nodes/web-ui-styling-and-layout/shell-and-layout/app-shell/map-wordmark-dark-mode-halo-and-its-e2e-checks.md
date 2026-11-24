---
type: map
title: Wordmark dark-mode halo and its e2e checks
description: >-
  The --wordmark-halo drop-shadows trace the navy wordmark outline in dark;
  e2e/typography.spec.ts checks the wordmark and halo.
tags:
  - web
  - brand
  - wordmark
kk_schema_version: 3
kk_id: map-wordmark-dark-mode-halo-and-its-e2e-checks
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0'
kk_relates_to:
  - practice-contrast-tables-and-project-colours
  - practice-visual-screenshot-baselines
  - practice-playwright-gotchas-in-the-e2e-specs
  - map-brand-component-and-the-png-wordmark-image
kk_depends_on: []
kk_confidence: high
---
The art has a near-black navy outline, `#000013`, that matches the dark `--bg` (`#08061f`, 1.04:1). It is part of the image, so it is not a token. In dark the `.brand .wordmark` rule adds four 1px `drop-shadow`s in `--wordmark-halo` (`#b9b5d6`, the dark `--muted`; transparent in light) to trace the edge. `--wordmark-halo` is the only wordmark token left in `styles.css`. The outline's and the halo's contrast rows are in the table there; recompute them when the art changes. Light still computes four `drop-shadow`s, in `rgba(0, 0, 0, 0)`, so a test for "no halo" looks for the halo colour, not for `filter: none`. `e2e/typography.spec.ts` checks that the wordmark is an `IMG` named Tokkl whose `src` matches `/brand/wordmark-<n>.png` and that it decodes. At `deviceScaleFactor` 1 and 2 it checks that each size is drawn at its width and at the served file's ratio within 1 px, and that `lg` picks `wordmark-260.png` at 1x and `wordmark-520.png` at 2x. It also checks for four halo shadows in `rgb(185, 181, 214)` in dark and none in light. Its helper `expectWordmarkAlone` checks that every `.brand` holds exactly one img, named Tokkl, in the sidebar, on the login page and in the phone header, because an extra small image would slip past the visual baselines' threshold.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](../../theme-and-tokens/practice-contrast-tables-and-project-colours.md)
- Related: [practice-visual-screenshot-baselines](../../../tooling-and-project/testing/practice-visual-screenshot-baselines.md)
- Related: [practice-playwright-gotchas-in-the-e2e-specs](../../../tooling-and-project/testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [map-brand-component-and-the-png-wordmark-image](map-brand-component-and-the-png-wordmark-image.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0
<!-- kk:citations:end -->
