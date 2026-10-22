---
type: practice
title: Report totals wrap as a flex row; an Amount figure never breaks
description: >-
  Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to
  its nowrap figures. The visual baselines show no Amount tile.
tags:
  - web
  - css
  - reports
  - layout
  - mobile
  - e2e
kk_schema_version: 3
kk_id: practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break
kk_derived_from: []
kk_relates_to:
  - practice-phone-layout-css-gotchas
  - practice-visual-screenshot-baselines
  - practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts
  - map-readme-screenshots-script
kk_depends_on: []
kk_confidence: high
---
The Summary report's totals (`.report-totals`, rendered by `packages/web/src/pages/reports/SummaryTab.tsx` and styled in `packages/web/src/pages/reports/reports.css`) are a wrapping flex row at every width, not a grid. The plain tiles share a width through `flex: 1 1 var(--tile-basis)`; `--tile-basis` is 220px, and 160px at 760px and below, where the times are set smaller. The Amount tile (`.report-totals-amount`) has `flex-basis: auto`, so it is as wide as its figures and takes a row of its own when they do not fit beside the other tiles. At 760px and below the Entries tile (`.report-totals-entries`) sizes to its content too, so it can share a row with Amount.

Each figure is a `.report-amount` span with `white-space: nowrap` and `overflow-wrap: normal`, while `.report-totals dd` keeps `overflow-wrap: anywhere` and `min-width: 0` for the other values. Several currencies therefore wrap between figures, never inside one. A grid of equal tiles broke a figure such as 11,507.90 inside the number on a phone and at 768px, because `dd` allows a break between any two characters.

The visual fixture (`e2e/fixtures-data/transfer/restore-full.json`) produces no amount, so the `reports-summary` baselines do not show the Amount tile. The e2e check is `expectWholeAmounts` in `e2e/report-tests-helpers.ts`, run by `e2e/report-display.spec.ts` at 1280, 900 and 768px and by `e2e/mobile-reports.spec.ts` on the `PHONE` device. It measures each figure's line boxes, so it catches a figure that wraps inside itself. `seedWideAmounts` seeds the reports it checks: the screenshot data from `scripts/screenshots-data.ts` without its running entry (the Summary then shows €11,507.90), a six-digit euro figure, and six-digit figures in two currencies. `money(page, cents, currency)` in the same file formats a figure with the browser's locale, the way the page does; use it rather than a hard-coded figure.

<!-- kk:related:start -->
# Related

- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
- Related: [practice-visual-screenshot-baselines](../../tooling-and-project/testing/practice-visual-screenshot-baselines.md)
- Related: [practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md)
- Related: [map-readme-screenshots-script](../../tooling-and-project/repo-and-scripts/map-readme-screenshots-script.md)
<!-- kk:related:end -->
